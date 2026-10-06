# Physics and Astrophysics Lab — Atmosphere Lab

PAL is an interactive 3D globe and draggable 2D map for Earth-systems experiments. The frontend uses Three.js and a complete NASA Blue Marble shaded-relief texture. A Python model evaluates an idealized tropical-cyclone pressure and wind field. A scheduled Python data build retrieves NHC storm status and Open-Meteo wind and ocean fields for GitHub Pages; the same Python code can run as an on-demand API. Open-Meteo also supplies nearby hourly weather forecasts. All data and simulations are labeled in the interface.

## Run locally

Use Python 3.10+ and Node 20+:

```sh
python -m backend.server
npm ci
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`. The Python API runs at `http://localhost:8000`. On GitHub Pages, custom parameters run through the same `backend/physics.py` module in a browser Web Worker using Pyodide. A JavaScript equation fallback is shown only if the Python runtime cannot load.

```sh
python -m unittest backend.test_physics -v
npm run build
python -m backend.cli --parameters storm.json --output result.json
```

## Physics

### Shared 2D and 3D storm field

The Python model samples surface wind components, wind speed, pressure, finite-difference convergence, and a dimensionless cloud proxy on a 41 by 41 local tangent-plane grid at 25 km spacing (1,000 km across). The 2D map draws wind and pressure shading from those samples, analytical 10 hPa isobars, a track, and advected wind streaks. The 3D globe uses the same wind samples for its local field and moving particles. Both views follow the same timeline; the 2D map also supports drag panning and wheel zoom.

The surface wind crosses the isobars at a user-selected inward angle from 0 to 40 degrees. A user-selected fraction from 0 to 1 of storm translation is added to the wind vector to show motion-related asymmetry. These are explicit boundary-layer approximations, not a terrain-aware fluid simulation. The cloud proxy comes from positive horizontal convergence with an eye mask; it is **not** satellite-observed cloud cover or a rainfall forecast. Wind particles are animated passive markers. The static Blue Marble image shows detailed land and ocean, not a current satellite frame.

The radial pressure and wind fields use a simplified, axisymmetric [Holland (1980)](https://doi.org/10.1175/1520-0493(1980)108%3C1212:AAMOTW%3E2.0.CO;2) model. At distance `r` from the center, with central pressure `p_c`, ambient pressure `p_n`, radius of maximum wind `R`, and shape factor `B`:

```text
x(r) = (R/r)^B
p(r) = p_c + (p_n - p_c) exp(-x)
V_gradient(r) = sqrt[B Δp x exp(-x)/ρ + (f r/2)^2] - f r/2
V_surface(r) = 0.9 V_gradient(r)
f = 2 Ω sin(latitude)
```

`Δp` is in pascals, `ρ = 1.15 kg/m³`, and `Ω = 7.2921159 × 10⁻⁵ rad/s`. The 0.9 surface reduction is an explicit simplifying assumption. `B` is inferred from the requested maximum wind and pressure deficit at `R`; if it falls outside 0.5–3.5, the model limits it and marks the result. Surface vectors use cyclonic rotation and a configurable inward crossing angle. The eye is calm at the exact center in this axisymmetric model.

The timeline moves the center along a spherical great circle at **constant user-set speed and heading**. It is a scenario path, never an official track forecast. Sea temperature is displayed as context; this model does not include a thermodynamic intensity equation or derive wind from sea temperature. It also lacks land interaction, vertical structure, evolving intensity, eyewall replacement, rainfall dynamics, and bathymetry. A kinematic asymmetry preview adds a configurable fraction of the chosen translation velocity to the surface wind vector; this factor is an assumption, not an NHC wind-radii analysis. The 34, 50, and 64 knot outer radii are interpolated from the symmetric profile, not official quadrant radii.

Surface wind particles are integrated through the modeled tangential and configurable inward flow at 45× model time for visibility; they are passive markers, not a numerical fluid solver. Raised, translucent spiral cloud bands rotate around the eye at 18× model time and use the selected radius of maximum wind; their shape is illustrative, not retrieved cloud structure. Playback speed (0.5× to 4×) changes presentation rate, not the physical storm motion. The Earth backdrop combines sourced NASA imagery with shaded terrain relief.

The analysis tab graphs pressure, wind, pressure gradient, kinetic energy density `ρV²/2`, kinetic energy flux `ρV³/2`, and vertical relative vorticity `(1/r) d(rV)/dr` by radius. It also graphs the kinematic eyewall wind by bearing and available Open-Meteo hourly wind, gust, pressure, precipitation, temperature, humidity, and cloud cover. These are local model or nearby forecast quantities, not comprehensive environmental measurements. The playback reveals model curves and weather hours; it does not change the model's constant inputs. Every chart can be exported as PNG or CSV, and a long-format CSV includes all available series.

The economic panel only produces a number after the user supplies an exposed-asset value. It uses the disclosed sensitivity curve:

```text
loss_fraction = 0.35 [1 - exp(-((max(V_kmh - 90, 0) / 100)^3))]
loss_USD = exposed_assets_USD × loss_fraction
```

The curve is **not calibrated to real building inventories or vulnerability classes** and cannot represent flooding or surge. A credible local loss assessment needs geocoded exposure, construction types, local hazard fields, and validated vulnerability functions such as those described in [FEMA Hazus](https://www.fema.gov/sites/default/files/documents/fema_hazus-hurricane-technical-manual-4.2.3_0.pdf). No dollar figure is shown without exposure input.

## Data provenance

| Layer | Source | Meaning |
| --- | --- | --- |
| Earth texture | [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) Blue Marble Shaded Relief | Complete 2K, 4K, and 8K textures are bundled with the site. The globe uses the largest supported tier for its screen and GPU. This is a static historical Earth composite, not current cloud imagery. |
| Nearby weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Gridded hourly forecast at the selected coordinates, not cyclone center observations. |
| Active Atlantic / eastern Pacific storms | [NOAA NHC CurrentStorms.json](https://www.nhc.noaa.gov/productexamples/) | Advisory center, wind, pressure, and motion retrieved by the Python API; no other basins implied. |
| Radial profile and scenario track | `backend/physics.py` | Idealized physics output. Live NHC values become initial conditions only. |
| Global wind/ocean arrows | [Open-Meteo Forecast](https://open-meteo.com/en/docs) and [Marine](https://open-meteo.com/en/docs/marine-weather-api) APIs | Sparse 7×7 sampled forecast grid through Python API. Local structure is unresolved; illustrative lines appear when the API is unavailable. |

This experiment is for exploration and education. Use official meteorological agencies for safety decisions.

## Deployment

The [GitHub Pages workflow](.github/workflows/pages.yml) runs the Python tests and [`build_snapshot.py`](backend/build_snapshot.py), builds the Vite frontend, and deploys it from `main`. It refreshes the snapshot hourly; every published snapshot includes its generation time. GitHub Pages cannot execute a Python server, so custom parameter changes load the pinned [Pyodide](https://pyodide.org/en/stable/usage/working-with-bundlers.html) runtime and run the actual Python physics module inside a browser worker. First use downloads the runtime from jsDelivr and may take several seconds. The default presets use Python-calculated snapshot results. NHC and global vector data on Pages can be delayed by Actions scheduling or source latency.

For immediate Python calculations, the optional [Render Blueprint](render.yaml) deploys `backend.server` on a free Python web service. Once it has a public URL, add repository variable `PAL_API_BASE` with that URL and rerun the Pages workflow. Render's free service may sleep after inactivity; the snapshot and browser equation fallback keep the UI usable. The site does not require Render to publish.

