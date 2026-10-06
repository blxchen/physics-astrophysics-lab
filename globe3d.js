import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const RAD = Math.PI / 180;
const R = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function point(lat, lon, altitude = 0) {
  const phi = lat * RAD, lam = lon * RAD, radius = R + altitude;
  return new THREE.Vector3(radius * Math.cos(phi) * Math.cos(lam), radius * Math.sin(phi), -radius * Math.cos(phi) * Math.sin(lam));
}
function buildStars() {
  const vertices = [];
  for (let i = 0; i < 1400; i++) {
    const t = i * 2.399963229728653, y = 1 - 2 * (i + .5) / 1400;
    const d = Math.sqrt(1 - y * y), radius = 7 + (i % 13) * .21;
    vertices.push(radius * d * Math.cos(t), radius * y, radius * d * Math.sin(t));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x8db7c9, size: .025, sizeAttenuation: true, transparent: true, opacity: .75 }));
}

export function createGlobe(canvas, state) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  // Keep a sharp globe without multiplying the fragment workload on retina screens.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .01, 40);
  camera.position.copy(point(state.scenario.lat, state.scenario.lon).multiplyScalar(3.15));
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .06;
  controls.enablePan = false;
  controls.minDistance = 1.16;
  controls.maxDistance = 7;
  controls.rotateSpeed = .65;
  controls.zoomSpeed = .85;
  scene.add(new THREE.AmbientLight(0x6e9eb6, 1.8));
  const sun = new THREE.DirectionalLight(0xfff2db, 3.1);
  sun.position.set(4, 2, 5);
  scene.add(sun, buildStars());

  const globeGeometry = new THREE.SphereGeometry(R, 96, 64);
  const earth = new THREE.Mesh(globeGeometry, new THREE.MeshStandardMaterial({ color: 0x4e8798, roughness: .95, metalness: 0 }));
  scene.add(earth);
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const requestedWidth = window.innerWidth >= 800 ? 4096 : 2048;
  const baseWidth = [8192, 4096, 2048].find(width => width <= Math.min(renderer.capabilities.maxTextureSize, requestedWidth)) || 2048;
  const imageLabel = document.getElementById('imageryDate');
  loader.load(`${import.meta.env.BASE_URL}earth/blue-marble-relief-${baseWidth / 1024}k.jpg`, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    earth.material.map = texture;
    earth.material.color.setHex(0xffffff);
    earth.material.needsUpdate = true;
    imageLabel.textContent = `NASA BLUE MARBLE RELIEF · ${baseWidth / 1024}K`;
  }, undefined, () => { imageLabel.textContent = 'BASE IMAGERY UNAVAILABLE'; });

  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.04, 64, 48), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false,
    uniforms: { glowColor: { value: new THREE.Color(0x4fcde1) } },
    vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main(){ vec4 world = modelMatrix * vec4(position,1.0); vNormal = normalize(mat3(modelMatrix)*normal); vView = normalize(cameraPosition-world.xyz); gl_Position=projectionMatrix*viewMatrix*world; }',
    fragmentShader: 'uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vView; void main(){ float edge=pow(1.0-max(0.0,dot(normalize(vNormal),normalize(vView))),2.2); gl_FragColor=vec4(glowColor,edge*.36); }'
  }));
  scene.add(atmosphere);

  const stormGroup = new THREE.Group();
  const pressureGroup = new THREE.Group();
  const fieldGroup = new THREE.Group();
  scene.add(stormGroup, pressureGroup, fieldGroup);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.013, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc9fff1 }));
  stormGroup.add(eye);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(.035, 20, 16), new THREE.MeshBasicMaterial({ color: 0x4ee5d0, transparent: true, opacity: .26, depthWrite: false }));
  stormGroup.add(halo);
  let scenario = state.scenario, model = null, mode = 'typhoon', layer = 'satellite', hour = 0;
  const fieldData = { wind: null, ocean: null };
  let trackLine, windPoints, windParticleState, lastWindTick = 0, cloudBands, cloudOrigin, fieldVisual, fieldOrigin, pressureOrigin;

  function clearObject(obj) {
    if (!obj) return;
    obj.parent?.remove(obj);
    obj.geometry?.dispose();
    obj.material?.dispose();
  }
  function makeLine(vertices, color, opacity = .6) {
    const geo = new THREE.BufferGeometry().setFromPoints(vertices);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  }
  function trackData() {
    if (model?.track?.length) return model.track;
    return Array.from({ length: 25 }, (_, i) => ({ hour: i * 3, latitude: scenario.lat + i * .25, longitude: scenario.lon - i * .4 }));
  }
  function centerAtHour(h) {
    const track = trackData(), index = clamp(Math.floor(h / 3), 0, track.length - 1), next = track[Math.min(index + 1, track.length - 1)];
    const before = track[index], fraction = clamp((h - before.hour) / Math.max(1, next.hour - before.hour), 0, 1);
    let lonDelta = next.longitude - before.longitude;
    if (lonDelta > 180) lonDelta -= 360;
    if (lonDelta < -180) lonDelta += 360;
    return { latitude: before.latitude + (next.latitude - before.latitude) * fraction, longitude: before.longitude + lonDelta * fraction };
  }
  function positionAtHour(h) {
    const p = centerAtHour(h);
    return point(p.latitude, p.longitude, .029);
  }
  function rebuildTrack() {
    clearObject(trackLine);
    trackLine = makeLine(trackData().map(p => point(p.latitude, p.longitude, .018)), 0xa5f2df, .7);
    stormGroup.add(trackLine);
  }
  function rebuildPressure() {
    for (const child of [...pressureGroup.children]) clearObject(child);
    pressureGroup.quaternion.identity();
    const center = centerAtHour(hour);
    pressureOrigin = center;
    for (const radiusKm of (model?.isobars?.length ? model.isobars.map(row => row.radius_km) : [45, 90, 150, 240, 350])) {
      const vertices = [];
      for (let i = 0; i <= 120; i++) {
        const angle = i / 120 * Math.PI * 2;
        const lat = center.latitude + Math.sin(angle) * radiusKm / 111.2;
        const lon = center.longitude + Math.cos(angle) * radiusKm / (111.2 * Math.max(.2, Math.cos(center.latitude * RAD)));
        vertices.push(point(lat, lon, .026));
      }
      pressureGroup.add(makeLine(vertices, 0x8fe7d2, .5));
    }
  }
  function rebuildWind() {
    clearObject(windPoints);
    const count = 800;
    const positions = new Float32Array(count * 3);
    windParticleState = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const radius = 14 + 330 * Math.sqrt(((i * 977) % count) / count);
      const angle = i * 2.3999632297;
      windParticleState[i * 2] = radius * Math.cos(angle);
      windParticleState[i * 2 + 1] = radius * Math.sin(angle);
    }
    lastWindTick = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x9cf6da, size: .012, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false });
    windPoints = new THREE.Points(geometry, material);
    stormGroup.add(windPoints);
  }
  function rebuildCloudBands() {
    clearObject(cloudBands);
    const positions = [];
    const colors = [];
    const rmax = Number(document.getElementById('radiusMax').value) || 38;
    const center = centerAtHour(hour);
    cloudOrigin = center;
    const sign = center.latitude >= 0 ? 1 : -1;
    // A schematic raised canopy: six logarithmic spiral arms with a clear eye.
    // Geometry follows the selected Rmax; NASA imagery remains the observed layer.
    for (let arm = 0; arm < 6; arm++) {
      for (let j = 0; j < 175; j++) {
        const u = j / 174;
        const radiusKm = rmax * (.78 + 7.2 * u);
        const spiral = sign * (arm * Math.PI / 3 + 4.9 * u);
        for (let strand = 0; strand < 3; strand++) {
          const jitter = Math.sin(j * 12.9898 + arm * 78.233 + strand * 31.17);
          const angle = spiral + (strand - 1) * .045 + jitter * .014;
          const radius = radiusKm * (1 + .027 * jitter);
          const lat = center.latitude + Math.sin(angle) * radius / 111.2;
          const lon = center.longitude + Math.cos(angle) * radius / (111.2 * Math.max(.2, Math.cos(center.latitude * RAD)));
          const altitude = .034 + .018 * Math.exp(-(((u - .18) / .3) ** 2)) + strand * .002;
          const p = point(lat, lon, altitude);
          positions.push(p.x, p.y, p.z);
          const brightness = .54 + .34 * Math.exp(-(((u - .17) / .34) ** 2)) + .05 * jitter;
          colors.push(brightness, brightness * 1.035, brightness * 1.055);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    cloudBands = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: .017, sizeAttenuation: true, transparent: true, opacity: .48, depthWrite: false }));
    stormGroup.add(cloudBands);
  }
  function rebuildFieldVisual() {
    clearObject(fieldVisual);
    const grid = model?.field_grid;
    if (!grid) return;
    const center = centerAtHour(hour); fieldOrigin = center;
    const positions = [], colors = [];
    for (let j = 0; j < grid.size; j++) for (let i = 0; i < grid.size; i++) {
      const east = (i - (grid.size - 1) / 2) * grid.step_km;
      const north = (j - (grid.size - 1) / 2) * grid.step_km;
      const lat = center.latitude + north / 111.2;
      const lon = center.longitude + east / (111.2 * Math.max(.2, Math.cos(center.latitude * RAD)));
      const p = point(lat, lon, .025), speed = grid.wind_kmh[j * grid.size + i];
      const color = new THREE.Color().setHSL(.55 - .49 * clamp(speed / 260, 0, 1), .9, .5);
      positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    fieldVisual = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: .025, sizeAttenuation: true, transparent: true, opacity: .65, depthWrite: false }));
    stormGroup.add(fieldVisual);
  }
  function updateWind(t) {
    if (!windPoints || !state.windTrails || mode !== 'typhoon') return;
    const arr = windPoints.geometry.attributes.position.array;
    const center = centerAtHour(hour);
    const grid = model?.field_grid;
    const fallbackWind = model?.inputs?.maximum_wind_kmh ?? scenario.wind;
    const dt = lastWindTick ? Math.min(.08, (t - lastWindTick) / 1000) : 0;
    lastWindTick = t;
    const heading = scenario.heading * RAD, steering = scenario.speed / 3.6 * (model?.inputs?.translation_factor ?? .5);
    const northSign = center.latitude >= 0 ? 1 : -1;
    for (let i = 0; i < arr.length / 3; i++) {
      let east = windParticleState[i * 2], north = windParticleState[i * 2 + 1];
      let radiusKm = Math.hypot(east, north);
      if (radiusKm < 12 || radiusKm > 430) {
        const angle = i * 2.3999632297 + t * .00008;
        east = 290 * Math.cos(angle); north = 290 * Math.sin(angle); radiusKm = 290;
      }
      let wind = fallbackWind * Math.exp(-radiusKm / 250);
      const speed = wind / 3.6, crossing = (model?.inputs?.inflow_angle_deg ?? 18) * RAD, tangential = Math.cos(crossing) * speed, inward = Math.sin(crossing) * speed;
      let u = -northSign * tangential * north / radiusKm - inward * east / radiusKm + steering * Math.sin(heading);
      let v = northSign * tangential * east / radiusKm - inward * north / radiusKm + steering * Math.cos(heading);
      if (grid && Math.abs(east) <= grid.extent_km && Math.abs(north) <= grid.extent_km) {
        const ix = clamp(Math.round(east / grid.step_km + (grid.size - 1) / 2), 0, grid.size - 1);
        const iy = clamp(Math.round(north / grid.step_km + (grid.size - 1) / 2), 0, grid.size - 1);
        const index = iy * grid.size + ix; u = grid.u_ms[index]; v = grid.v_ms[index];
      }
      east += u * dt * 45 / 1000; north += v * dt * 45 / 1000;
      windParticleState[i * 2] = east; windParticleState[i * 2 + 1] = north;
      const lat = center.latitude + north / 111.2;
      const lon = center.longitude + east / (111.2 * Math.max(.2, Math.cos(center.latitude * RAD)));
      const p = point(lat, lon, .022 + .004 * Math.sin(i * 1.8 + t * .003));
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    windPoints.geometry.attributes.position.needsUpdate = true;
  }
  function buildGlobalField() {
    for (const child of [...fieldGroup.children]) clearObject(child);
    const kind = mode === 'winds' ? 'wind' : mode;
    const samples = fieldData[kind];
    if (samples?.length) {
      for (const sample of samples) {
        const bearing = (sample.direction_deg + (kind === 'wind' ? 180 : 0)) * RAD;
        const length = clamp(kind === 'wind' ? sample.speed_kmh / 12 : sample.speed_kmh * 2.5, .7, 3.5);
        const lat1 = sample.latitude, lon1 = sample.longitude;
        const lat2 = clamp(lat1 + Math.cos(bearing) * length, -86, 86);
        const lon2 = lon1 + Math.sin(bearing) * length / Math.max(.25, Math.cos(lat1 * RAD));
        const tip = point(lat2, lon2, .03), tail = point(lat1, lon1, .03);
        const color = kind === 'wind' ? 0x9df1d5 : 0x5bdbe7;
        fieldGroup.add(makeLine([tail, tip], color, .85));
        const spread = .55;
        fieldGroup.add(makeLine([point(lat2 - Math.cos(bearing - spread) * length * .3, lon2 - Math.sin(bearing - spread) * length * .3, .03), tip, point(lat2 - Math.cos(bearing + spread) * length * .3, lon2 - Math.sin(bearing + spread) * length * .3, .03)], color, .85));
      }
      return;
    }
    if (kind === 'clouds') return;
    const count = 24;
    for (let j = 0; j < count; j++) {
      const lat0 = -72 + j * 144 / (count - 1), vertices = [];
      for (let lon = -180; lon <= 180; lon += 2) {
        const waviness = kind === 'ocean' ? 5 : 1.5;
        vertices.push(point(lat0 + waviness * Math.sin(lon * RAD * 2.6 + j * .7), lon, .014 + j % 3 * .002));
      }
      fieldGroup.add(makeLine(vertices, kind === 'ocean' ? 0x49d4dc : 0x8ce8cc, .35));
    }
  }
  function setFieldData(kind, points) { fieldData[kind] = points; buildGlobalField(); }
  function setStorm(next, nextModel = null, shouldFocus = true) {
    scenario = next; model = nextModel;
    rebuildTrack(); rebuildPressure(); rebuildWind(); rebuildCloudBands(); rebuildFieldVisual();
    if (shouldFocus) focus(next.lat, next.lon);
  }
  function focus(lat, lon) {
    const dist = camera.position.length();
    camera.position.copy(point(lat, lon).multiplyScalar(dist));
    controls.target.set(0, 0, 0);
    controls.update();
  }
  function setMode(nextMode, nextLayer) {
    mode = nextMode; layer = nextLayer;
    stormGroup.visible = mode === 'typhoon' || mode === 'clouds';
    pressureGroup.visible = mode === 'typhoon' && layer === 'pressure';
    fieldGroup.visible = mode === 'winds' || mode === 'ocean';
    buildGlobalField();
  }
  function setHour(nextHour) { hour = nextHour; }
  function setTrack(enabled) { if (trackLine) trackLine.visible = enabled; }
  function setWind(enabled) { if (windPoints) windPoints.visible = enabled; }
  function reset() { focus(scenario.lat, scenario.lon); camera.position.normalize().multiplyScalar(3.15); controls.update(); }
  function zoom(delta) { camera.position.multiplyScalar(delta < 0 ? .85 : 1.15); camera.position.clampLength(1.16, 7); controls.update(); }
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  setStorm(scenario);
  setMode('typhoon', 'satellite');
  let lastFrame = 0;
  function animate(t) {
    requestAnimationFrame(animate);
    if (document.hidden || canvas.hidden || !canvas.offsetWidth || t - lastFrame < 32) return;
    lastFrame = t;
    controls.update();
    eye.position.copy(positionAtHour(hour));
    halo.position.copy(eye.position);
    halo.scale.setScalar(1 + .16 * Math.sin(t * .003));
    if (trackLine) trackLine.visible = mode === 'typhoon' && state.track;
    if (windPoints) windPoints.visible = mode === 'typhoon' && state.windTrails;
    if (cloudBands) cloudBands.visible = mode === 'clouds' || (mode === 'typhoon' && layer === 'satellite');
    if (fieldVisual) fieldVisual.visible = mode === 'typhoon' && layer === 'winds';
    if (cloudBands && cloudOrigin) {
      const center = centerAtHour(hour);
      const axis = point(center.latitude, center.longitude).normalize();
      const move = new THREE.Quaternion().setFromUnitVectors(point(cloudOrigin.latitude, cloudOrigin.longitude).normalize(), axis);
      const surfaceSpeed = (Number(document.getElementById('intensity').value) || 150) / 3.6;
      const radiusMetres = (Number(document.getElementById('radiusMax').value) || 40) * 1000;
      const angle = (center.latitude >= 0 ? 1 : -1) * t / 1000 * 18 * surfaceSpeed / radiusMetres;
      cloudBands.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, angle)).multiply(move);
    }
    if (fieldVisual && fieldOrigin) {
      const center = centerAtHour(hour);
      fieldVisual.quaternion.setFromUnitVectors(point(fieldOrigin.latitude, fieldOrigin.longitude).normalize(), point(center.latitude, center.longitude).normalize());
    }
    if (pressureOrigin && pressureGroup.visible) {
      const center = centerAtHour(hour);
      pressureGroup.quaternion.setFromUnitVectors(point(pressureOrigin.latitude, pressureOrigin.longitude).normalize(), point(center.latitude, center.longitude).normalize());
    }
    updateWind(t);
    fieldGroup.rotation.y = 0;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
  return { setStorm, setMode, setFieldData, setHour, setTrack, setWind, reset, zoom, focus };
}

