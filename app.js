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
const state = { scenario: scenarios[0], experiment: 'typhoon', tab: 'simulation', layer: 'satellite', hour: 0, playing: false, playbackSpeed: 1, windTrails: true, track: true, observed: null, weatherSeries: null, weatherStart: 0, obsStatus: 'loading', model: null, modelSource: 'pending' };
const globe = createGlobe($('globeCanvas'), state);
let simulationTimer = 0;
let simulationRequest = 0;
const fieldCache = {};
let snapshot = null;
let pythonWorker;
const pythonPending = new Map();
let pythonJob = 0;

function browserPython(parameters) {
  if (!pythonWorker) {
    pythonWorker = new Worker(new URL('./python-worker.js', import.meta.url), { type: 'module' });
    pythonWorker.onmessage = ({ data }) => {
      const pending = pythonPending.get(data.id);
      if (!pending) return;
      pythonPending.delete(data.id);
      clearTimeout(pending.timer);
      data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
    };
    pythonWorker.onerror = () => {
      for (const pending of pythonPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Python worker unavailable')); }
      pythonPending.clear(); pythonWorker.terminate(); pythonWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++pythonJob;
    const timer = setTimeout(() => { pythonPending.delete(id); reject(new Error('Python load timed out')); }, 45000);
    pythonPending.set(id, { resolve, reject, timer });
    pythonWorker.postMessage({ id, parameters });
  });
}

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
  state.scenario = s; state.model = null; setHour(0);
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
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m&forecast_days=3&timezone=UTC`;
  try {
    const response = await fetch(url); if (!response.ok) throw new Error('Weather service unavailable');
    const data = await response.json(); if (s !== state.scenario) return;
    const now = new Date(), hour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())).toISOString().slice(0, 16);
    let i = data.hourly.time.findIndex(t => t === hour); if (i < 0) i = 0;
    state.weatherStart = i;
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
  const windAt = radiusKm => {
    if (!radiusKm) return 0;
    const r = radiusKm * 1000, x = (p.radius_max_wind_km / radiusKm) ** b;
    return .9 * (Math.sqrt(Math.max(0, b * dp / 1.15 * x * Math.exp(-x) + (f * r / 2) ** 2)) - f * r / 2);
  };
  const radii = [...new Set([0, 2, p.radius_max_wind_km, ...Array.from({ length: 100 }, (_, i) => (i + 1) * 5)])].sort((a, b) => a - b);
  const radial_profile = radii.map(radius_km => {
    const x = radius_km ? (p.radius_max_wind_km / radius_km) ** b : 0, wind = windAt(radius_km);
    const pressure_hpa = radius_km ? p.central_pressure_hpa + (p.ambient_pressure_hpa - p.central_pressure_hpa) * Math.exp(-x) : p.central_pressure_hpa;
    const delta = radius_km ? Math.min(.5, radius_km / 2) : 0;
    const vorticity = radius_km ? ((radius_km + delta) * windAt(radius_km + delta) - (radius_km - delta) * windAt(radius_km - delta)) / (2 * delta * radius_km * 1000) : 0;
    return { radius_km, wind_kmh: +(wind * 3.6).toFixed(2), pressure_hpa: +pressure_hpa.toFixed(2), pressure_gradient_pa_km: +(radius_km ? dp * Math.exp(-x) * b * x / radius_km : 0).toFixed(2), wind_energy_j_m3: +(.575 * wind * wind).toFixed(2), wind_power_w_m2: +(.575 * wind ** 3).toFixed(2), vorticity_1e5_s: +((p.latitude >= 0 ? 1 : -1) * vorticity * 1e5).toFixed(3) };
  });
  const track = Array.from({ length: 25 }, (_, i) => { const hour = i * 3, [latitude, longitude] = localDestination(p.latitude, p.longitude, p.heading_deg, p.translation_kmh * hour); return { hour, latitude, longitude }; });
  const peak_profile_wind_kmh = Math.max(...radial_profile.map(x => x.wind_kmh));
  const excess = Math.max(0, peak_profile_wind_kmh - 90), loss_fraction = .35 * (1 - Math.exp(-((excess / 100) ** 3)));
  const radiusFor = threshold => { for (let i = radial_profile.length - 1; i > 0; i--) { const outer = radial_profile[i], inner = radial_profile[i - 1]; if (inner.wind_kmh >= threshold && outer.wind_kmh < threshold) return +(outer.radius_km + (threshold - outer.wind_kmh) / (inner.wind_kmh - outer.wind_kmh) * (inner.radius_km - outer.radius_km)).toFixed(1); } return null; };
  const azimuthal_profile = Array.from({ length: 73 }, (_, i) => {
    const bearing_deg = i * 5, angle = bearing_deg * RAD, east = Math.sin(angle), north = Math.cos(angle), sign = p.latitude >= 0 ? 1 : -1, v = windAt(p.radius_max_wind_km), crossing = 18 * RAD, motion = .5 * p.translation_kmh / 3.6;
    const u = -sign * v * Math.cos(crossing) * north - v * Math.sin(crossing) * east + motion * Math.sin(p.heading_deg * RAD);
    const y = sign * v * Math.cos(crossing) * east - v * Math.sin(crossing) * north + motion * Math.cos(p.heading_deg * RAD);
    return { bearing_deg, wind_kmh: +(Math.hypot(u, y) * 3.6).toFixed(2) };
  });
  return { radial_profile, track, azimuthal_profile, wind_radii_km: { '34kt': radiusFor(34 * 1.852), '50kt': radiusFor(50 * 1.852), '64kt': radiusFor(64 * 1.852) }, shape_parameter_b: b, shape_parameter_limited: Math.abs(b - inferred) > 1e-9, peak_profile_wind_kmh, loss: p.exposed_assets_usd ? { status: 'illustrative', estimated_loss_usd: p.exposed_assets_usd * loss_fraction, loss_fraction } : { status: 'exposure_required', estimated_loss_usd: null, loss_fraction: null } };
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
  if (!model) {
    try { model = await browserPython(data); source = 'PYTHON IN BROWSER'; }
    catch { source = 'BROWSER EQUATION FALLBACK'; }
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
  $('windRadii').innerHTML = ['34kt', '50kt', '64kt'].map(key => `<span><strong>${key}</strong> ${m?.wind_radii_km?.[key] == null ? '—' : `${m.wind_radii_km[key]} km`}</span>`).join('');
  drawChart();
}
const chartSpecs = {
  wind_kmh: ['Surface wind', 'km/h', 'radial'], pressure_hpa: ['Pressure', 'hPa', 'radial'],
  pressure_gradient_pa_km: ['Pressure gradient', 'Pa/km', 'radial'], wind_energy_j_m3: ['Wind energy density', 'J/m³', 'radial'],
  wind_power_w_m2: ['Wind energy flux', 'W/m²', 'radial'], vorticity_1e5_s: ['Relative vorticity', '10⁻⁵ s⁻¹', 'radial'],
  azimuthal_wind: ['Eyewall wind by bearing', 'km/h', 'azimuth'],
  track_latitude: ['Scenario track latitude', '°', 'track', 'latitude'],
  track_longitude: ['Scenario track longitude', '°', 'track', 'longitude'],
  track_distance: ['Scenario travel distance', 'km', 'track', 'distance'],
  loss_fraction: ['Wind vulnerability curve', '%', 'impact'],
  loss_usd: ['Assumed dollar loss curve', 'USD', 'impact'],
  weather_wind: ['Nearby forecast wind', 'km/h', 'weather', 'wind_speed_10m'],
  weather_gust: ['Nearby forecast gust', 'km/h', 'weather', 'wind_gusts_10m'],
  weather_direction: ['Nearby wind direction', '° from north', 'weather', 'wind_direction_10m'],
  weather_pressure: ['Nearby forecast pressure', 'hPa', 'weather', 'pressure_msl'],
  weather_rain: ['Nearby forecast rain', 'mm/h', 'weather', 'precipitation'],
  weather_temp: ['Nearby air temperature', '°C', 'weather', 'temperature_2m'],
  weather_humidity: ['Nearby humidity', '%', 'weather', 'relative_humidity_2m'],
  weather_cloud: ['Nearby cloud cover', '%', 'weather', 'cloud_cover']
};
function chartData(key) {
  const spec = chartSpecs[key]; if (!spec) return null;
  const [title, unit, type, field] = spec;
  let rows = [];
  if (type === 'radial') rows = (state.model?.radial_profile || []).map(p => ({ x: p.radius_km, value: p[key] }));
  if (type === 'azimuth') rows = (state.model?.azimuthal_profile || []).map(p => ({ x: p.bearing_deg, value: p.wind_kmh }));
  if (type === 'track') rows = (state.model?.track || []).map(p => ({ x: p.hour, value: field === 'distance' ? controls().speed * p.hour : p[field] }));
  if (type === 'impact') rows = Array.from({ length: 61 }, (_, i) => { const x = i * 5, fraction = .35 * (1 - Math.exp(-((Math.max(x - 90, 0) / 100) ** 3))); return { x, value: key === 'loss_fraction' ? fraction * 100 : controls().assets * fraction }; });
  if (type === 'weather') rows = (state.weatherSeries?.[field] || []).slice(state.weatherStart, state.weatherStart + 49).map((value, x) => ({ x, value, valid_time_utc: state.weatherSeries.time?.[state.weatherStart + x] || '' }));
  if (key === 'loss_usd' && !controls().assets) rows = [];
  rows = rows.filter(p => Number.isFinite(p.value));
  return { key, title, unit, type, source: type === 'weather' ? 'OPEN-METEO HOURLY FORECAST' : type === 'impact' ? 'ASSUMED EXPOSURE SENSITIVITY' : 'PYTHON HOLLAND-TYPE MODEL', xUnit: type === 'weather' || type === 'track' ? 'hour' : type === 'azimuth' ? 'degree' : type === 'impact' ? 'km/h' : 'km', maxX: type === 'weather' ? 48 : type === 'track' ? 72 : type === 'azimuth' ? 360 : type === 'impact' ? 300 : 500, rows };
}
function drawPlot(canvas, key) {
  const data = chartData(key), rect = canvas.getBoundingClientRect(); if (!rect.width || !data) return;
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2), width = rect.width, height = rect.height;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const L = 47, R = 12, T = 16, B = 19, rows = data.rows;
  g.clearRect(0, 0, width, height);
  if (!rows.length) { g.fillStyle = '#8ca9b4'; g.font = '12px DM Sans'; g.fillText(data.type === 'weather' ? 'Weather feed unavailable' : 'Calculating Python model', 16, height / 2); return; }
  const values = rows.map(p => p.value), min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const xOf = p => L + p.x / data.maxX * (width - L - R), yOf = p => T + (max - p.value) / span * (height - T - B);
  g.font = '10px DM Sans'; g.fillStyle = '#86a4b3'; g.strokeStyle = '#29495b'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = T + i * (height - T - B) / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(width - R, y); g.stroke(); const tick = max - i * span / 4; g.fillText(Math.abs(tick) >= 10000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(tick) : tick.toFixed(Math.abs(span) > 100 ? 0 : 1), 2, y + 3); }
  g.strokeStyle = '#48728277'; g.lineWidth = 1.5; g.beginPath(); rows.forEach((p, i) => i ? g.lineTo(xOf(p), yOf(p)) : g.moveTo(xOf(p), yOf(p))); g.stroke();
  const reveal = data.type === 'weather' || data.type === 'track' ? Math.min(data.maxX, state.hour) : data.maxX * state.hour / 72;
  const played = rows.filter(p => p.x <= reveal);
  const next = rows.find(p => p.x > reveal);
  if (played.length && next && played[played.length - 1].x < reveal) {
    const previous = played[played.length - 1], fraction = (reveal - previous.x) / (next.x - previous.x);
    played.push({ x: reveal, value: previous.value + (next.value - previous.value) * fraction });
  }
  if (played.length) {
    const fill = g.createLinearGradient(0, T, 0, height - B); fill.addColorStop(0, '#66e1ce55'); fill.addColorStop(1, '#66e1ce00');
    g.beginPath(); played.forEach((p, i) => i ? g.lineTo(xOf(p), yOf(p)) : g.moveTo(xOf(p), yOf(p)));
    g.lineTo(xOf(played[played.length - 1]), height - B); g.lineTo(xOf(played[0]), height - B); g.closePath(); g.fillStyle = fill; g.fill();
    g.beginPath(); played.forEach((p, i) => i ? g.lineTo(xOf(p), yOf(p)) : g.moveTo(xOf(p), yOf(p))); g.strokeStyle = '#8cebd3'; g.lineWidth = 2.5; g.stroke();
    const tip = played[played.length - 1]; g.beginPath(); g.arc(xOf(tip), yOf(tip), 4, 0, 2 * Math.PI); g.fillStyle = '#f1bc83'; g.fill();
  }
  if (data.type === 'radial') { const rmX = L + controls().rmax / 500 * (width - L - R); g.setLineDash([4, 5]); g.beginPath(); g.moveTo(rmX, T); g.lineTo(rmX, height - B); g.strokeStyle = '#f2b78099'; g.stroke(); g.setLineDash([]); }
}
function drawChart() {
  if (state.tab !== 'analysis') return;
  const key = $('chartMetric').value, data = chartData(key);
  $('chartSource').textContent = data.source;
  $('chartTitle').textContent = `${data.title} · ${data.unit}`;
  $('chartAxis').innerHTML = `<span>0 ${data.xUnit.toUpperCase()}</span><span>${data.maxX / 2} ${data.xUnit.toUpperCase()}</span><span>${data.maxX} ${data.xUnit.toUpperCase()}</span>`;
  drawPlot($('chartCanvas'), key);
  for (const [id, metric] of [['miniWind', 'wind_kmh'], ['miniPressure', 'pressure_hpa'], ['miniPower', 'wind_power_w_m2'], ['miniWeather', 'weather_wind']]) drawPlot($(id), metric);
}
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
function exportCsv(key = $('chartMetric').value) {
  const data = chartData(key); if (!data?.rows.length) return;
  const csv = [`# ${data.title}; source=${data.source}; playback_hour=${state.hour.toFixed(2)}`, `x_${data.xUnit},value_${data.unit},valid_time_utc`, ...data.rows.map(p => `${p.x},${p.value},${p.valid_time_utc || ''}`)].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `pal-${state.scenario.id}-${key}.csv`);
}
function exportAllCsv() {
  const csv = ['series,source,x,x_unit,value,value_unit,valid_time_utc'];
  for (const key of Object.keys(chartSpecs)) { const data = chartData(key); for (const p of data.rows) csv.push(`${key},${data.source},${p.x},${data.xUnit},${p.value},${data.unit},${p.valid_time_utc || ''}`); }
  downloadBlob(new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8' }), `pal-${state.scenario.id}-all-data.csv`);
}
function exportPng(canvas, key) {
  if (!canvas.width) return;
  const data = chartData(key), dpr = clamp(window.devicePixelRatio || 1, 1, 2), header = Math.round(76 * dpr);
  const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height + header;
  const g = output.getContext('2d'); g.fillStyle = '#091c2c'; g.fillRect(0, 0, output.width, output.height);
  g.scale(dpr, dpr); g.fillStyle = '#dff7f1'; g.font = 'bold 17px Space Grotesk, sans-serif'; g.fillText(`${state.scenario.name} · ${data.title}`, 18, 30);
  g.fillStyle = '#82aaba'; g.font = '11px DM Sans, sans-serif'; g.fillText(`${data.source} · ${data.unit} by ${data.xUnit} · playback ${state.hour.toFixed(1)} h`, 18, 52);
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(canvas, 0, header);
  output.toBlob(blob => { if (blob) downloadBlob(blob, `pal-${state.scenario.id}-${key}.png`); }, 'image/png');
}

document.querySelectorAll('[data-experiment]').forEach(b => b.onclick = () => setExperiment(b.dataset.experiment));
document.querySelectorAll('.view-tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
document.querySelectorAll('.rail-button[data-layer]').forEach(b => b.onclick = () => setLayer(b.dataset.layer));
for (const id of ['intensity', 'pressure', 'seaTemp', 'stormSpeed', 'radiusMax', 'assetExposure']) $(id).addEventListener('input', updateControls);
$('chartMetric').onchange = drawChart;
$('exportCsv').onclick = () => exportCsv();
$('exportAllCsv').onclick = exportAllCsv;
$('exportPng').onclick = () => exportPng($('chartCanvas'), $('chartMetric').value);
document.querySelectorAll('[data-chart-png]').forEach(button => button.onclick = () => {
  const canvas = button.closest('.chart-card').querySelector('canvas');
  exportPng(canvas, button.dataset.chartPng);
});
$('resetControls').onclick = () => { $('assetExposure').value = ''; setControls(state.scenario); };
$('refreshData').onclick = () => { fetchWeather(); fetchLiveStorms(); };
$('resetGlobe').onclick = () => globe.reset(); $('zoomIn').onclick = () => globe.zoom(-1); $('zoomOut').onclick = () => globe.zoom(1);
for (const [id, key] of [['windToggle', 'windTrails'], ['trackToggle', 'track']]) $(id).onclick = () => { state[key] = !state[key]; $(id).classList.toggle('on', state[key]); $(id).setAttribute('aria-checked', String(state[key])); key === 'track' ? globe.setTrack(state[key]) : globe.setWind(state[key]); };
function setHour(value) {
  state.hour = clamp(value, 0, 72);
  $('timeline').value = state.hour; $('analysisTimeline').value = state.hour;
  const stamp = `HOUR ${state.hour.toFixed(1).padStart(4, '0')} / 72`;
  $('timelineStamp').textContent = stamp; $('analysisStamp').textContent = stamp;
  globe.setHour(state.hour); drawChart();
}
function setPlaying(playing) {
  state.playing = playing;
  $('playButton').textContent = playing ? 'Ⅱ' : '▶';
  $('analysisPlay').textContent = playing ? 'Ⅱ' : '▶';
}
$('timeline').oninput = () => setHour(+$('timeline').value);
$('analysisTimeline').oninput = () => setHour(+$('analysisTimeline').value);
$('playButton').onclick = () => setPlaying(!state.playing);
$('analysisPlay').onclick = () => setPlaying(!state.playing);
$('playbackSpeed').onchange = () => { state.playbackSpeed = +$('playbackSpeed').value; $('analysisSpeed').textContent = `${state.playbackSpeed}×`; };
let lastPlaybackTick = performance.now();
setInterval(() => {
  const now = performance.now(), elapsed = Math.min(.25, (now - lastPlaybackTick) / 1000); lastPlaybackTick = now;
  if (state.playing) setHour(state.hour + elapsed * 4 * state.playbackSpeed > 72 ? 0 : state.hour + elapsed * 4 * state.playbackSpeed);
}, 80);
$('newScenario').onclick = () => $('stormDialog').showModal(); $('closeDialog').onclick = () => $('stormDialog').close();
$('randomScenario').onclick = () => {
  const basins = [[18, 135, 'Western Pacific'], [20, -72, 'North Atlantic'], [15, 85, 'Bay of Bengal'], [-18, 115, 'South Indian Ocean']];
  const [lat0, lon0, region] = basins[Math.floor(Math.random() * basins.length)];
  const wind = Math.round(90 + Math.random() * 175), pressure = Math.round(clamp(1010 - .39 * wind + (Math.random() - .5) * 18, 890, 995));
  const s = { id: `synthetic-${Date.now()}`, name: `Storm ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`, region, type: 'Synthetic cyclone', lat: +(lat0 + (Math.random() - .5) * 9).toFixed(1), lon: +(lon0 + (Math.random() - .5) * 13).toFixed(1), wind, pressure, seaTemp: +(27 + Math.random() * 4).toFixed(1), speed: Math.round(8 + Math.random() * 27), rmax: Math.round(22 + Math.random() * 65), heading: Math.round(Math.random() * 360) };
  scenarios.push(s); selectScenario(s.id);
};
$('eyewallFocus').onclick = () => { globe.focus(state.scenario.lat, state.scenario.lon); globe.zoom(-1); globe.zoom(-1); };
$('stormForm').onsubmit = e => { e.preventDefault(); const name = $('customName').value.trim(), lat = +$('customLat').value, lon = +$('customLon').value; if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return; const s = { id: `custom-${Date.now()}`, name, region: 'Custom location', type: 'Custom storm', lat, lon, wind: 130, pressure: 970, seaTemp: 29, speed: 18, rmax: 40, heading: 315 }; scenarios.push(s); $('stormDialog').close(); $('stormForm').reset(); selectScenario(s.id); };
function tickClock() { $('utcClock').textContent = new Date().toISOString().slice(11, 16) + ' UTC'; }
tickClock(); setInterval(tickClock, 30000); window.addEventListener('resize', drawChart);
selectScenario('pacific'); loadSnapshot(); fetchLiveStorms();

