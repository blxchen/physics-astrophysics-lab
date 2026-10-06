import { createGlobe } from './globe3d.js';

const $ = id => document.getElementById(id);
const RAD = Math.PI / 180;
const API_BASE = (import.meta.env.VITE_PAL_API_BASE || (location.hostname === 'localhost' ? 'http://localhost:8000' : '')).replace(/\/$/, '');
const scenarios = [
  { id: 'pacific', name: 'Pacific vortex', region: 'Western Pacific', type: 'Tropical cyclone', lat: 18.8, lon: 126.2, wind: 184, pressure: 942, seaTemp: 29.4, speed: 22, rmax: 38, heading: 315 },
  { id: 'atlantic', name: 'Atlantic spiral', region: 'North Atlantic', type: 'Hurricane', lat: 22.3, lon: -68.7, wind: 156, pressure: 958, seaTemp: 28.7, speed: 19, rmax: 44, heading: 305 },
  { id: 'indian', name: 'Indian gyre', region: 'Bay of Bengal', type: 'Cyclone', lat: 16.5, lon: 87.2, wind: 132, pressure: 972, seaTemp: 30.1, speed: 14, rmax: 52, heading: 330 }
];
const experimentMeta = {
  typhoon: ['Typhoon dynamics', 'Explore the forces that shape tropical cyclones.', 'Western Pacific'],
  winds: ['Global winds', 'Illustrative circulation lines over the 3D Earth.', 'Atmospheric circulation'],
  ocean: ['Ocean currents', 'Explore illustrative heat-transport paths.', 'Ocean circulation'],
  clouds: ['Cloud systems', 'Explore daily satellite cloud cover.', 'Cloud cover']
};
const state = { scenario: scenarios[0], experiment: 'typhoon', tab: 'simulation', layer: 'satellite', hour: 0, playing: false, windTrails: true, track: true, observed: null, weatherSeries: null, obsStatus: 'loading', model: null, modelSource: 'pending' };
const globe = createGlobe($('globeCanvas'), state);
let simulationTimer = 0;
let simulationRequest = 0;
const fieldCache = {};
let snapshot = null;

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function formatCoord(lat, lon) { return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`; }
function category(wind) { if (wind < 119) return 'TS'; if (wind < 154) return 'CAT 1'; if (wind < 178) return 'CAT 2'; if (wind < 209) return 'CAT 3'; if (wind < 252) return 'CAT 4'; return 'CAT 5'; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function controls() { return { wind: +$('intensity').value, pressure: +$('pressure').value, seaTemp: +$('seaTemp').value, speed: +$('stormSpeed').value, rmax: +$('radiusMax').value, assets: Math.max(0, +$('assetExposure').value || 0) }; }
function payload() { const v = controls(), s = state.scenario; return { latitude: s.lat, longitude: s.lon, maximum_wind_kmh: v.wind, central_pressure_hpa: v.pressure, ambient_pressure_hpa: Math.max(1010, v.pressure + 8), radius_max_wind_km: v.rmax, translation_kmh: v.speed, heading_deg: s.heading, sea_temperature_c: v.seaTemp, exposed_assets_usd: v.assets }; }
function setControls(s) { $('intensity').value = s.wind; $('pressure').value = s.pressure; $('seaTemp').value = s.seaTemp; $('stormSpeed').value = s.speed; $('radiusMax').value = s.rmax; updateControls(); }
function updateControls() {
  const v = controls();
  $('intensityValue').innerHTML = `${v.wind} <small>km/h</small>`;
  $('pressureValue').innerHTML = `${v.pressure} <small>hPa</small>`;
  $('seaTempValue').innerHTML = `${v.seaTemp.toFixed(1)} <small>°C</small>`;
  $('stormSpeedValue').innerHTML = `${v.speed} <small>km/h</small>`;
  $('radiusMaxValue').innerHTML = `${v.rmax} <small>km</small>`;
  $('categoryBadge').textContent = category(v.wind);
  scheduleSimulation();
}
function renderScenarios() {
  $('scenarioList').innerHTML = scenarios.map(s => `<button class="scenario ${s.id === state.scenario.id ? 'active' : ''}" data-scenario="${s.id}"><span class="scenario-mark">${s.live ? '◌' : '◉'}</span><span><strong>${escapeHtml(s.name)}</strong><small>${s.live ? 'NHC DATA · ' : ''}${escapeHtml(s.region)}</small></span><span class="scenario-arrow">→</span></button>`).join('');
  document.querySelectorAll('[data-scenario]').forEach(b => b.onclick = () => selectScenario(b.dataset.scenario));
}
function selectScenario(id) {
  const s = scenarios.find(x => x.id === id);
  if (!s) return;
  state.scenario = s; state.hour = 0; state.model = null;
  $('timeline').value = 0; $('timelineStamp').textContent = 'HOUR 00 / 72';
  $('stormName').textContent = s.name;
  $('stormType').textContent = `${s.type} · ${s.region}${s.live ? ' · NHC initial conditions' : ''}`;
  $('sceneTitle').textContent = s.region;
  $('coordinates').textContent = formatCoord(s.lat, s.lon);
  globe.setStorm(s);
  setControls(s); renderScenarios(); fetchWeather();
}
function setExperiment(key) {
  state.experiment = key;
  const [title, sub, scene] = experimentMeta[key];
  $('pageTitle').innerHTML = `${title}<span class="title-period">.</span>`;
  $('pageSubtitle').textContent = sub;
  $('sceneTitle').textContent = key === 'typhoon' ? state.scenario.region : scene;
  document.querySelectorAll('[data-experiment]').forEach(b => b.classList.toggle('active', b.dataset.experiment === key));
  setLayer(key === 'winds' ? 'winds' : key === 'ocean' ? 'ocean' : 'satellite');
}
function setLayer(layer) {
  state.layer = layer;
  document.querySelectorAll('.rail-button[data-layer]').forEach(b => b.classList.toggle('active', b.dataset.layer === layer));
  $('legendLabel').textContent = layer === 'satellite' ? 'NASA SATELLITE IMAGERY' : layer === 'winds' ? 'ILLUSTRATIVE WIND LINES' : layer === 'ocean' ? 'ILLUSTRATIVE OCEAN LINES' : 'HOLLAND PRESSURE PROFILE';
  globe.setMode(state.experiment, layer);
  if (layer === 'winds' || layer === 'ocean') fetchField(layer === 'winds' ? 'wind' : 'ocean');
}
function setTab(tab) {
  state.tab = tab;
  $('simulationView').hidden = tab !== 'simulation'; $('analysisView').hidden = tab !== 'analysis';
  document.querySelectorAll('.view-tab').forEach(b => { const active = b.dataset.tab === tab; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); });
  if (tab === 'analysis') renderAnalysis();
}

async function fetchWeather() {
  const s = state.scenario; state.observed = null; state.weatherSeries = null; state.obsStatus = 'loading'; updateDataStatus();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m&forecast_days=2&timezone=UTC`;
  try {
    const response = await fetch(url); if (!response.ok) throw new Error('Weather service unavailable');
    const data = await response.json(); if (s !== state.scenario) return;
    const now = new Date(), hour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())).toISOString().slice(0, 16);
    let i = data.hourly.time.findIndex(t => t === hour); if (i < 0) i = 0;
    state.observed = { time: data.hourly.time[i], temperature: data.hourly.temperature_2m[i], humidity: data.hourly.relative_humidity_2m[i], rain: data.hourly.precipitation[i], cloud: data.hourly.cloud_cover[i], pressure: data.hourly.pressure_msl[i], wind: data.hourly.wind_speed_10m[i] };
    state.weatherSeries = data.hourly;
    state.obsStatus = 'live';
  } catch { state.obsStatus = 'offline'; }
  updateDataStatus(); renderAnalysis();
}
function updateDataStatus() {
  $('connectionText').textContent = state.obsStatus === 'live' ? 'WEATHER DATA CONNECTED' : state.obsStatus === 'loading' ? 'LOADING DATA' : 'SCENARIO MODE';
  $('sidebarStatus').textContent = state.obsStatus === 'live' ? 'Open-Meteo hourly data loaded' : state.obsStatus === 'loading' ? 'Connecting to weather data' : 'Weather service unavailable';
  $('observationDescription').textContent = state.obsStatus === 'live' ? `Open-Meteo forecast grid point at ${formatCoord(state.scenario.lat, state.scenario.lon)}, ${state.observed.time.replace('T', ' ')} UTC.` : state.obsStatus === 'loading' ? 'Fetching nearby weather from Open-Meteo.' : 'Open-Meteo unavailable; nearby weather values are omitted.';
}

function localDestination(lat, lon, heading, distanceKm) {
  const phi = lat * RAD, lambda = lon * RAD, bearing = heading * RAD, delta = distanceKm / 6371;
  const lat2 = Math.asin(Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(bearing));
  const lon2 = lambda + Math.atan2(Math.sin(bearing) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(lat2));
  return [lat2 / RAD, ((lon2 / RAD + 180) % 360) - 180];
}
function localSimulation(p) {
  const dp = (p.ambient_pressure_hpa - p.central_pressure_hpa) * 100, rmax = p.radius_max_wind_km * 1000;
  const f = Math.abs(2 * 7.2921159e-5 * Math.sin(p.latitude * RAD)), vg = p.maximum_wind_kmh / 3.6 / .9;
  const inferred = 1.15 * Math.E * (vg * vg + f * rmax * vg) / dp, b = clamp(inferred, .5, 3.5);
  const radii = [0, 2, 5, 10, 15, 20, 25, 30, 38, 45, 55, 70, 90, 120, 160, 220, 300, 400, 500];
  const radial_profile = radii.map(radius_km => {
    if (!radius_km) return { radius_km, wind_kmh: 0, pressure_hpa: p.central_pressure_hpa };
    const r = radius_km * 1000, x = (p.radius_max_wind_km / radius_km) ** b;
    const pressure_hpa = p.central_pressure_hpa + (p.ambient_pressure_hpa - p.central_pressure_hpa) * Math.exp(-x);
    const wind_kmh = .9 * (Math.sqrt(Math.max(0, b * dp / 1.15 * x * Math.exp(-x) + (f * r / 2) ** 2)) - f * r / 2) * 3.6;
    return { radius_km, wind_kmh: +wind_kmh.toFixed(2), pressure_hpa: +pressure_hpa.toFixed(2) };
  });
  const track = Array.from({ length: 25 }, (_, i) => { const hour = i * 3, [latitude, longitude] = localDestination(p.latitude, p.longitude, p.heading_deg, p.translation_kmh * hour); return { hour, latitude, longitude }; });
  const peak_profile_wind_kmh = Math.max(...radial_profile.map(x => x.wind_kmh));
  const excess = Math.max(0, peak_profile_wind_kmh - 90), loss_fraction = .35 * (1 - Math.exp(-((excess / 100) ** 3)));
  return { radial_profile, track, shape_parameter_b: b, shape_parameter_limited: Math.abs(b - inferred) > 1e-9, peak_profile_wind_kmh, loss: p.exposed_assets_usd ? { status: 'illustrative', estimated_loss_usd: p.exposed_assets_usd * loss_fraction, loss_fraction } : { status: 'exposure_required', estimated_loss_usd: null, loss_fraction: null } };
}
function scheduleSimulation() { clearTimeout(simulationTimer); simulationTimer = setTimeout(runSimulation, 160); }
async function runSimulation() {
  const request = ++simulationRequest, data = payload();
  let model = null, source = 'BROWSER EQUATION FALLBACK';
  if (API_BASE) {
    try {
      const response = await fetch(`${API_BASE}/api/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(9000) });
      if (!response.ok) throw new Error('API unavailable');
      model = await response.json(); source = 'PYTHON PHYSICS API';
    } catch { /* The same documented equations run locally when the service sleeps. */ }
  }
  const preset = snapshot?.presets?.[state.scenario.id];
  if (!model && preset && Object.entries(data).every(([key, value]) => Math.abs(value - (preset.inputs?.[key] ?? NaN)) < 1e-8)) {
    model = preset; source = 'PYTHON ACTIONS SNAPSHOT';
  }
  if (request !== simulationRequest) return;
  state.model = model || localSimulation(data); state.modelSource = source;
  const limited = state.model.shape_parameter_limited ? ' · PARAMETER LIMITED' : '';
  $('modelSummary').textContent = `${source}${limited}`;
  globe.setStorm(state.scenario, state.model, false);
  renderAnalysis();
}
async function fetchLiveStorms() {
  let items = snapshot?.storms || [];
  if (API_BASE) { try { const response = await fetch(`${API_BASE}/api/storms`, { signal: AbortSignal.timeout(9000) }); if (response.ok) items = (await response.json()).storms || items; } catch { /* Keep snapshot. */ } }
  for (const s of items) {
    if (scenarios.some(x => x.id === s.id)) continue;
    scenarios.unshift({ id: s.id, name: s.name, region: 'NHC advisory region', type: s.classification || 'Tropical cyclone', lat: s.latitude, lon: s.longitude, wind: Math.round(s.wind_kmh), pressure: Math.round(s.pressure_hpa), seaTemp: 28, speed: Math.round(s.translation_kmh || 0), rmax: 40, heading: s.heading_deg ?? 315, live: true });
  }
  renderScenarios();
}
async function fetchField(kind) {
  if (fieldCache[kind]) { globe.setFieldData(kind, fieldCache[kind]); $('legendLabel').textContent = `OPEN-METEO ${kind.toUpperCase()} GRID · ${fieldCache[kind].length} SAMPLES`; return; }
  let data = snapshot?.fields?.[kind];
  if (API_BASE) { try { const response = await fetch(`${API_BASE}/api/field?kind=${kind}`, { signal: AbortSignal.timeout(18000) }); if (response.ok) data = await response.json(); } catch { /* Keep snapshot. */ } }
  if (!data?.grid_points?.length) return;
  fieldCache[kind] = data.grid_points;
  globe.setFieldData(kind, data.grid_points);
  if (state.layer === (kind === 'wind' ? 'winds' : 'ocean')) $('legendLabel').textContent = `OPEN-METEO ${kind.toUpperCase()} GRID · ${data.grid_points.length} SAMPLES`;
}
async function loadSnapshot() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/snapshot.json`, { cache: 'no-store' });
    if (!response.ok) return;
    snapshot = await response.json();
    if (snapshot.generated_at) $('snapshotStamp').textContent = `· SNAPSHOT ${snapshot.generated_at.slice(0, 16).replace('T', ' ')} UTC`;
    fetchLiveStorms();
    if (state.layer === 'winds' || state.layer === 'ocean') fetchField(state.layer === 'winds' ? 'wind' : 'ocean');
    runSimulation();
  } catch { /* A local development build may not have a generated snapshot. */ }
}

function metricCard(label, value, unit, kind = 'model') { return `<div class="metric-card ${kind}"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`; }
function renderAnalysis() {
  const v = controls(), o = state.observed, m = state.model, has = !!o, source = state.modelSource.startsWith('PYTHON') ? 'PYTHON MODEL' : 'SAME EQUATIONS · BROWSER';
  $('metricGrid').innerHTML = [
    metricCard('PEAK PROFILE WIND', m ? m.peak_profile_wind_kmh.toFixed(0) : '—', `KM/H · ${source}`),
    metricCard('CENTRAL PRESSURE', v.pressure.toFixed(0), 'HPA · INPUT'),
    metricCard('RADIUS OF MAX WIND', v.rmax.toFixed(0), 'KM · INPUT'),
    metricCard('HOLLAND SHAPE B', m ? m.shape_parameter_b.toFixed(2) : '—', m?.shape_parameter_limited ? 'LIMITED TO 0.5–3.5' : 'DIMENSIONLESS'),
    metricCard('SEA TEMPERATURE', v.seaTemp.toFixed(1), '°C · INPUT'),
    metricCard('TRANSLATION', v.speed.toFixed(0), 'KM/H · SCENARIO'),
    metricCard('NEARBY WIND', has ? o.wind.toFixed(0) : '—', has ? 'KM/H · OPEN-METEO' : 'WEATHER OFFLINE', 'observed'),
    metricCard('NEARBY PRESSURE', has ? o.pressure.toFixed(0) : '—', has ? 'HPA · OPEN-METEO' : 'WEATHER OFFLINE', 'observed'),
    metricCard('AIR TEMPERATURE', has ? o.temperature.toFixed(1) : '—', has ? '°C · OPEN-METEO' : 'WEATHER OFFLINE', 'observed'),
    metricCard('HUMIDITY', has ? o.humidity.toFixed(0) : '—', has ? '% · OPEN-METEO' : 'WEATHER OFFLINE', 'observed'),
    metricCard('PRECIPITATION', has ? o.rain.toFixed(1) : '—', has ? 'MM · OPEN-METEO' : 'WEATHER OFFLINE', 'observed'),
    metricCard('CLOUD COVER', has ? o.cloud.toFixed(0) : '—', has ? '% · OPEN-METEO' : 'WEATHER OFFLINE', 'observed')
  ].join('');
  const loss = m?.loss;
  $('damageEstimate').textContent = loss?.estimated_loss_usd != null ? `$${(loss.estimated_loss_usd / 1e9).toFixed(2)}B` : '—';
  $('impactBars').innerHTML = loss?.loss_fraction != null ? `<div class="impact-bar"><div><span>Assumed exposure</span><span>$${(v.assets / 1e9).toFixed(2)}B</span></div><div><i style="width:100%"></i></div></div><div class="impact-bar"><div><span>Wind vulnerability fraction</span><span>${(loss.loss_fraction * 100).toFixed(1)}%</span></div><div><i style="width:${loss.loss_fraction * 100}%"></i></div></div>` : '<span class="impact-empty">Enter exposed assets to calculate a sensitivity value.</span>';
  drawChart();
}
function drawChart() {
  const c = $('chartCanvas'); if (state.tab !== 'analysis' || !c) return;
  const rect = c.getBoundingClientRect(); if (!rect.width) return;
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2); c.width = rect.width * dpr; c.height = rect.height * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const w = rect.width, h = rect.height, L = 42, R = 12, T = 15, B = 18, key = $('chartMetric').value;
  const weather = key.startsWith('weather_');
  $('chartSource').textContent = weather ? 'OPEN-METEO HOURLY FORECAST' : 'RADIAL WIND MODEL';
  $('chartTitle').textContent = weather ? 'Nearby weather forecast' : 'Storm structure';
  $('chartAxis').innerHTML = weather ? '<span>NOW</span><span>+24 HRS</span><span>+48 HRS</span>' : '<span>0 KM</span><span>250 KM</span><span>500 KM</span>';
  const sourceKey = { weather_wind: 'wind_speed_10m', weather_pressure: 'pressure_msl', weather_rain: 'precipitation' }[key];
  const rows = weather ? (state.weatherSeries?.[sourceKey] || []).slice(0, 48).map((value, i) => ({ radius_km: i / 47 * 500, value })) : (state.model?.radial_profile || []).map(row => ({ ...row, value: row[key] }));
  g.clearRect(0, 0, w, h);
  if (!rows.length) { g.fillStyle = '#8ca9b4'; g.font = '12px DM Sans'; g.fillText(weather ? 'Weather feed unavailable' : 'Calculating model profile', 18, h / 2); return; }
  const vals = rows.map(x => x.value), min = Math.min(...vals), max = Math.max(...vals), span = Math.max(1, max - min);
  g.clearRect(0, 0, w, h); g.font = '9px DM Sans'; g.fillStyle = '#7897a5'; g.strokeStyle = '#274557'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = T + i * (h - T - B) / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText((max - i * span / 4).toFixed(key === 'pressure_hpa' ? 0 : 1), 2, y + 3); }
  const xOf = row => L + row.radius_km / 500 * (w - L - R), yOf = row => T + (max - row.value) / span * (h - T - B);
  const fill = g.createLinearGradient(0, T, 0, h - B); fill.addColorStop(0, '#61deca55'); fill.addColorStop(1, '#61deca00');
  g.beginPath(); rows.forEach((row, i) => i ? g.lineTo(xOf(row), yOf(row)) : g.moveTo(xOf(row), yOf(row))); g.lineTo(w - R, h - B); g.lineTo(L, h - B); g.closePath(); g.fillStyle = fill; g.fill();
  g.beginPath(); rows.forEach((row, i) => i ? g.lineTo(xOf(row), yOf(row)) : g.moveTo(xOf(row), yOf(row))); g.strokeStyle = '#8cebd3'; g.lineWidth = 2.5; g.stroke();
  if (!weather) { const rmX = L + controls().rmax / 500 * (w - L - R); g.setLineDash([4, 5]); g.beginPath(); g.moveTo(rmX, T); g.lineTo(rmX, h - B); g.strokeStyle = '#f2b78099'; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
}
function exportCsv() {
  if (!state.model) return;
  const csv = ['radius_km,wind_kmh,pressure_hpa', ...state.model.radial_profile.map(x => `${x.radius_km},${x.wind_kmh},${x.pressure_hpa}`)].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `pal-${state.scenario.id}-radial-profile.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.querySelectorAll('[data-experiment]').forEach(b => b.onclick = () => setExperiment(b.dataset.experiment));
document.querySelectorAll('.view-tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
document.querySelectorAll('.rail-button[data-layer]').forEach(b => b.onclick = () => setLayer(b.dataset.layer));
for (const id of ['intensity', 'pressure', 'seaTemp', 'stormSpeed', 'radiusMax', 'assetExposure']) $(id).addEventListener('input', updateControls);
$('chartMetric').onchange = drawChart; $('exportCsv').onclick = exportCsv;
$('resetControls').onclick = () => { $('assetExposure').value = ''; setControls(state.scenario); };
$('refreshData').onclick = () => { fetchWeather(); fetchLiveStorms(); };
$('resetGlobe').onclick = () => globe.reset(); $('zoomIn').onclick = () => globe.zoom(-1); $('zoomOut').onclick = () => globe.zoom(1);
for (const [id, key] of [['windToggle', 'windTrails'], ['trackToggle', 'track']]) $(id).onclick = () => { state[key] = !state[key]; $(id).classList.toggle('on', state[key]); $(id).setAttribute('aria-checked', String(state[key])); key === 'track' ? globe.setTrack(state[key]) : globe.setWind(state[key]); };
$('timeline').oninput = () => { state.hour = +$('timeline').value; globe.setHour(state.hour); $('timelineStamp').textContent = `HOUR ${String(state.hour).padStart(2, '0')} / 72`; };
$('playButton').onclick = () => { state.playing = !state.playing; $('playButton').textContent = state.playing ? 'Ⅱ' : '▶'; };
setInterval(() => { if (state.playing) { state.hour = (state.hour + 1) % 73; $('timeline').value = state.hour; globe.setHour(state.hour); $('timelineStamp').textContent = `HOUR ${String(state.hour).padStart(2, '0')} / 72`; } }, 180);
$('newScenario').onclick = () => $('stormDialog').showModal(); $('closeDialog').onclick = () => $('stormDialog').close();
$('stormForm').onsubmit = e => { e.preventDefault(); const name = $('customName').value.trim(), lat = +$('customLat').value, lon = +$('customLon').value; if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return; const s = { id: `custom-${Date.now()}`, name, region: 'Custom location', type: 'Custom storm', lat, lon, wind: 130, pressure: 970, seaTemp: 29, speed: 18, rmax: 40, heading: 315 }; scenarios.push(s); $('stormDialog').close(); $('stormForm').reset(); selectScenario(s.id); };
function tickClock() { $('utcClock').textContent = new Date().toISOString().slice(11, 16) + ' UTC'; }
tickClock(); setInterval(tickClock, 30000); window.addEventListener('resize', drawChart);
selectScenario('pacific'); loadSnapshot(); fetchLiveStorms();

