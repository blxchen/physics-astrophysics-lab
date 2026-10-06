const RAD = Math.PI / 180;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;

export function createMap(canvas, state) {
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas'), baseContext = base.getContext('2d');
  const image = new Image();
  let imageRequested = false;
  function ensureImage() {
    if (imageRequested) return;
    imageRequested = true;
    image.src = `${import.meta.env.BASE_URL}earth/blue-marble-relief-${window.innerWidth >= 1100 ? '8k' : '4k'}.jpg`;
  }
  image.onload = () => { backgroundDirty = true; };
  let width = 0, height = 0, dpr = 1, centerLat = state.scenario.lat, centerLon = state.scenario.lon;
  let degreesPerPixel = .026, following = true, mode = 'typhoon', layer = 'satellite';
  let scenario = state.scenario, model = null, hour = 0, backgroundDirty = true, fieldImage = null;
  let drag = null, lastFrame = 0;
  const globalFields = { wind: null, ocean: null };
  const particles = Array.from({ length: 520 }, (_, i) => {
    const radius = 25 + 440 * Math.sqrt(((i * 947) % 520) / 520), angle = i * 2.3999632297;
    return { east: radius * Math.cos(angle), north: radius * Math.sin(angle) };
  });

  function centerAtHour() {
    const track = model?.track;
    if (!track?.length) return { latitude: scenario.lat, longitude: scenario.lon };
    const i = clamp(Math.floor(hour / 3), 0, track.length - 1), a = track[i], b = track[Math.min(i + 1, track.length - 1)];
    const fraction = clamp((hour - a.hour) / Math.max(1, b.hour - a.hour), 0, 1);
    return { latitude: a.latitude + (b.latitude - a.latitude) * fraction, longitude: wrap(a.longitude + wrap(b.longitude - a.longitude) * fraction) };
  }
  function project(lat, lon) {
    const longitude = wrap(lon - centerLon);
    return [width / 2 + longitude * Math.cos(centerLat * RAD) / degreesPerPixel,
      height / 2 + (centerLat - lat) / degreesPerPixel];
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    base.width = canvas.width; base.height = canvas.height;
    backgroundDirty = true;
  }
  new ResizeObserver(resize).observe(canvas);
  function drawBackground() {
    if (!backgroundDirty) return;
    backgroundDirty = false;
    baseContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseContext.fillStyle = '#071522'; baseContext.fillRect(0, 0, width, height);
    if (!image.complete || !image.naturalWidth) return;
    const xScale = Math.cos(centerLat * RAD) / degreesPerPixel, yScale = 1 / degreesPerPixel;
    const mapWidth = 360 * xScale, x0 = width / 2 + (-180 - centerLon) * xScale;
    const y0 = height / 2 + (centerLat - 90) * yScale;
    baseContext.imageSmoothingEnabled = true;
    for (let offset = -1; offset <= 2; offset++) {
      const x = x0 + offset * mapWidth;
      if (x < width && x + mapWidth > 0) baseContext.drawImage(image, x, y0, mapWidth, 180 * yScale);
    }
    baseContext.fillStyle = 'rgba(4,18,30,.16)'; baseContext.fillRect(0, 0, width, height);
  }
  function color(value, type) {
    if (type === 'pressure') {
      const f = clamp((1012 - value) / 90, 0, 1);
      return [Math.round(55 + 190 * f), Math.round(155 - 75 * f), Math.round(215 - 145 * f), Math.round(160 * f)];
    }
    if (type === 'cloud') return [240, 249, 255, Math.round(190 * clamp(value, 0, 1))];
    const f = clamp(value / 250, 0, 1);
    return [Math.round(40 + 210 * f), Math.round(176 - 40 * f), Math.round(230 - 155 * f), Math.round(180 * Math.sqrt(f))];
  }
  function rebuildFieldImage() {
    const grid = model?.field_grid;
    if (!grid) { fieldImage = null; return; }
    fieldImage = document.createElement('canvas'); fieldImage.width = grid.size; fieldImage.height = grid.size;
    const fieldContext = fieldImage.getContext('2d'), pixels = fieldContext.createImageData(grid.size, grid.size);
    const kind = mode === 'clouds' || layer === 'satellite' ? 'cloud' : layer === 'pressure' ? 'pressure' : 'wind';
    const values = kind === 'cloud' ? grid.cloud_proxy : kind === 'pressure' ? grid.pressure_hpa : grid.wind_kmh;
    for (let j = 0; j < grid.size; j++) for (let i = 0; i < grid.size; i++) {
      const source = j * grid.size + i, target = ((grid.size - 1 - j) * grid.size + i) * 4;
      const rgba = color(values[source], kind);
      pixels.data.set(rgba, target);
    }
    fieldContext.putImageData(pixels, 0, 0);
  }
  function drawField(center) {
    const grid = model?.field_grid;
    if (!fieldImage || !grid || (mode !== 'typhoon' && mode !== 'clouds')) return;
    const cos = Math.max(.2, Math.cos(center.latitude * RAD));
    const extentLat = grid.extent_km / 111.2, extentLon = extentLat / cos;
    const [left, top] = project(center.latitude + extentLat, center.longitude - extentLon);
    const pixels = 2 * extentLat / degreesPerPixel;
    ctx.globalAlpha = mode === 'clouds' ? .95 : .72;
    ctx.drawImage(fieldImage, left, top, pixels * Math.cos(centerLat * RAD) / cos, pixels);
    ctx.globalAlpha = 1;
  }
  function drawIsobars(center) {
    if (mode !== 'typhoon' || layer !== 'pressure') return;
    const [x, y] = project(center.latitude, center.longitude);
    ctx.strokeStyle = 'rgba(255,244,218,.82)'; ctx.fillStyle = '#fff4da'; ctx.lineWidth = 1.2; ctx.font = '11px IBM Plex Mono, monospace';
    for (const row of model?.isobars || []) {
      const radius = row.radius_km / 111.2 / degreesPerPixel;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
      if (radius > 22 && radius < Math.min(width, height) * .8) ctx.fillText(`${row.pressure_hpa} hPa`, x + radius * .7 + 4, y - radius * .7);
    }
  }
  function drawTrack() {
    if (mode !== 'typhoon' || !state.track || !model?.track?.length) return;
    ctx.strokeStyle = 'rgba(255,224,153,.86)'; ctx.lineWidth = 2; ctx.setLineDash([7, 6]); ctx.beginPath();
    model.track.forEach((row, i) => { const [x, y] = project(row.latitude, row.longitude); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  function drawGlobalVectors(t) {
    if (mode !== 'winds' && mode !== 'ocean') return;
    const kind = mode === 'ocean' ? 'ocean' : 'wind', samples = globalFields[kind] || [];
    for (const sample of samples) {
      const [x, y] = project(sample.latitude, sample.longitude);
      if (x < -30 || x > width + 30 || y < -30 || y > height + 30) continue;
      const angle = (sample.direction_deg + (kind === 'wind' ? 180 : 0)) * RAD;
      const length = clamp(kind === 'wind' ? sample.speed_kmh * .5 : sample.speed_kmh * 22, 9, 32);
      const dx = Math.sin(angle) * length, dy = -Math.cos(angle) * length;
      ctx.strokeStyle = kind === 'wind' ? 'rgba(147,244,216,.8)' : 'rgba(104,220,255,.8)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - dx / 2, y - dy / 2); ctx.lineTo(x + dx / 2, y + dy / 2); ctx.stroke();
      const pulse = ((t * .0004 + sample.longitude * .007) % 1 + 1) % 1;
      ctx.fillStyle = '#e7fff5'; ctx.beginPath(); ctx.arc(x - dx / 2 + pulse * dx, y - dy / 2 + pulse * dy, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawParticles(center, dt) {
    const grid = model?.field_grid;
    if (!grid || (mode !== 'typhoon' && mode !== 'clouds') || !state.windTrails) return;
    ctx.lineWidth = 1.2; ctx.strokeStyle = mode === 'clouds' || layer === 'satellite' ? 'rgba(245,251,255,.74)' : layer === 'pressure' ? 'rgba(255,233,190,.7)' : 'rgba(170,253,232,.72)';
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const ix = clamp(Math.round(p.east / grid.step_km + (grid.size - 1) / 2), 0, grid.size - 1);
      const iy = clamp(Math.round(p.north / grid.step_km + (grid.size - 1) / 2), 0, grid.size - 1);
      const index = iy * grid.size + ix;
      const u = grid.u_ms[index], v = grid.v_ms[index];
      p.east += u * dt * 95 / 1000;
      p.north += v * dt * 95 / 1000;
      if (Math.hypot(p.east, p.north) < 12 || Math.abs(p.east) > 480 || Math.abs(p.north) > 480) {
        const angle = i * 2.3999632297 + hour * .03;
        p.east = 420 * Math.cos(angle); p.north = 420 * Math.sin(angle);
      }
      const cos = Math.max(.2, Math.cos(center.latitude * RAD));
      const [x, y] = project(center.latitude + p.north / 111.2, center.longitude + p.east / (111.2 * cos));
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const speed = Math.hypot(u, v), length = clamp(speed * .25, 2, 10);
      const dx = speed ? u / speed * length : 0, dy = speed ? -v / speed * length : 0;
      ctx.globalAlpha = clamp(speed / 55, .18, .9);
      ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawHud(center) {
    const [x, y] = project(center.latitude, center.longitude);
    if (mode === 'typhoon' || mode === 'clouds') {
      ctx.strokeStyle = '#fff1ce'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#f9fff5'; ctx.font = '600 12px Mulish, sans-serif'; ctx.fillText(scenario.name, x + 12, y - 11);
    }
    const bar = 200 / 111.2 / degreesPerPixel;
    ctx.strokeStyle = '#f0f6f2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(22, height - 25); ctx.lineTo(22 + bar, height - 25); ctx.stroke();
    ctx.fillStyle = '#f0f6f2'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.fillText('200 km', 22, height - 31);
    if (mode === 'typhoon' && layer !== 'satellite') {
      const label = layer === 'pressure' ? 'PRESSURE · hPa' : 'WIND · km/h';
      const min = layer === 'pressure' ? '1012' : '0', max = layer === 'pressure' ? '922' : '250+';
      const gradient = ctx.createLinearGradient(width - 170, 0, width - 20, 0);
      gradient.addColorStop(0, layer === 'pressure' ? '#379bd7' : '#28b0e6');
      gradient.addColorStop(1, layer === 'pressure' ? '#f55046' : '#f2a253');
      ctx.fillStyle = '#f4f8f5'; ctx.fillText(label, width - 170, height - 51);
      ctx.fillStyle = gradient; ctx.fillRect(width - 170, height - 42, 150, 5);
      ctx.fillStyle = '#f4f8f5'; ctx.fillText(min, width - 170, height - 27); ctx.fillText(max, width - 48, height - 27);
    }
  }
  function frame(t) {
    requestAnimationFrame(frame);
    if (canvas.hidden || !width || !height) { lastFrame = t; return; }
    ensureImage();
    const dt = lastFrame ? Math.min(.08, (t - lastFrame) / 1000) : 0; lastFrame = t;
    drawBackground(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.drawImage(base, 0, 0, width, height);
    const center = centerAtHour();
    drawField(center); drawIsobars(center); drawTrack(); drawGlobalVectors(t); drawParticles(center, dt); drawHud(center);
  }
  requestAnimationFrame(frame);
  canvas.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY, lat: centerLat, lon: centerLon }; following = false; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    centerLon = wrap(drag.lon - (event.clientX - drag.x) * degreesPerPixel / Math.max(.2, Math.cos(drag.lat * RAD)));
    centerLat = clamp(drag.lat + (event.clientY - drag.y) * degreesPerPixel, -80, 80); backgroundDirty = true;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', event => { event.preventDefault(); degreesPerPixel = clamp(degreesPerPixel * Math.exp(event.deltaY * .0012), .003, .35); backgroundDirty = true; }, { passive: false });
  function setStorm(next, nextModel = null) { scenario = next; model = nextModel; centerLat = next.lat; centerLon = next.lon; following = true; backgroundDirty = true; rebuildFieldImage(); }
  function setMode(nextMode, nextLayer) { mode = nextMode; layer = nextLayer; rebuildFieldImage(); }
  function setHour(nextHour) { hour = nextHour; if (following) { const center = centerAtHour(); centerLat = center.latitude; centerLon = center.longitude; backgroundDirty = true; } }
  function setFieldData(kind, points) { globalFields[kind] = points; }
  function reset() { degreesPerPixel = .026; following = true; const center = centerAtHour(); centerLat = center.latitude; centerLon = center.longitude; backgroundDirty = true; }
  function zoom(delta) { degreesPerPixel = clamp(degreesPerPixel * (delta < 0 ? .75 : 1.3), .003, .35); backgroundDirty = true; }
  function focus(lat, lon) { centerLat = lat; centerLon = lon; following = false; backgroundDirty = true; }
  return { setStorm, setMode, setHour, setFieldData, reset, zoom, focus };
}
