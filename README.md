# Physics and Astrophysics Lab — Atmosphere Lab

PAL is a 3D, interactive Earth-systems experiment. The frontend uses Three.js and daily NASA imagery. A Python model evaluates an idealized tropical-cyclone wind field. A scheduled Python data build retrieves NHC storm status and Open-Meteo wind and ocean fields for GitHub Pages; the same Python code can run as an on-demand API. Open-Meteo also supplies nearby hourly weather forecasts. All data and simulations are labeled in the interface.

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

The radial pressure and wind fields use a simplified, axisymmetric [Holland (1980)](https://doi.org/10.1175/1520-0493(1980)108%3C1212:AAMOTW%3E2.0.CO;2) model. At distance `r` from the center, with central pressure `p_c`, ambient pressure `p_n`, radius of maximum wind `R`, and shape factor `B`:

```text
x(r) = (R/r)^B
p(r) = p_c + (p_n - p_c) exp(-x)
V_gradient(r) = sqrt[B Δp x exp(-x)/ρ + (f r/2)^2] - f r/2
V_surface(r) = 0.9 V_gradient(r)
f = 2 Ω sin(latitude)
```

`Δp` is in pascals, `ρ = 1.15 kg/m³`, and `Ω = 7.2921159 × 10⁻⁵ rad/s`. The 0.9 surface reduction is an explicit simplifying assumption. `B` is inferred from the requested maximum wind and pressure deficit at `R`; if it falls outside 0.5–3.5, the model limits it and marks the result. Surface vectors use cyclonic rotation and an assumed 18° inward crossing angle. The eye is calm at the exact center in this axisymmetric model.

The timeline moves the center along a spherical great circle at **constant user-set speed and heading**. It is a scenario path, never an official track forecast. Sea temperature is displayed as context; this model does not include a thermodynamic intensity equation or derive wind from sea temperature. It also lacks land interaction, vertical structure, asymmetry, eyewall replacement, rainfall dynamics, and bathymetry. Wind particles visualize the radial profile with angular rate `V/r`, shown at 25× time for visibility; they are not a full numerical fluid simulation. Raised, translucent spiral cloud bands use the selected radius of maximum wind for an illustrative 3D canopy; their shape is not a retrieved cloud observation. The Earth backdrop is the sourced satellite image.

The economic panel only produces a number after the user supplies an exposed-asset value. It uses the disclosed sensitivity curve:

```text
loss_fraction = 0.35 [1 - exp(-((max(V_kmh - 90, 0) / 100)^3))]
loss_USD = exposed_assets_USD × loss_fraction
```

The curve is **not calibrated to real building inventories or vulnerability classes** and cannot represent flooding or surge. A credible local loss assessment needs geocoded exposure, construction types, local hazard fields, and validated vulnerability functions such as those described in [FEMA Hazus](https://www.fema.gov/sites/default/files/documents/fema_hazus-hurricane-technical-manual-4.2.3_0.pdf). No dollar figure is shown without exposure input.

## Data provenance

| Layer | Source | Meaning |
| --- | --- | --- |
| Earth texture | [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) Blue Marble Next Generation and MODIS Terra corrected reflectance | Continuous Blue Marble base (up to 8K) with the previous UTC day's MODIS swaths (up to 4K) overlaid. Black no-data swaths are masked to reveal the base. Neither layer is live video. |
| Nearby weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Gridded hourly forecast at the selected coordinates, not cyclone center observations. |
| Active Atlantic / eastern Pacific storms | [NOAA NHC CurrentStorms.json](https://www.nhc.noaa.gov/productexamples/) | Advisory center, wind, pressure, and motion retrieved by the Python API; no other basins implied. |
| Radial profile and scenario track | `backend/physics.py` | Idealized physics output. Live NHC values become initial conditions only. |
| Global wind/ocean arrows | [Open-Meteo Forecast](https://open-meteo.com/en/docs) and [Marine](https://open-meteo.com/en/docs/marine-weather-api) APIs | Sparse 7×7 sampled forecast grid through Python API. Local structure is unresolved; illustrative lines appear when the API is unavailable. |

This experiment is for exploration and education. Use official meteorological agencies for safety decisions.

## Deployment

The [GitHub Pages workflow](.github/workflows/pages.yml) runs the Python tests and [`build_snapshot.py`](backend/build_snapshot.py), builds the Vite frontend, and deploys it from `main`. It refreshes the snapshot hourly; every published snapshot includes its generation time. GitHub Pages cannot execute a Python server, so custom parameter changes load the pinned [Pyodide](https://pyodide.org/en/stable/usage/working-with-bundlers.html) runtime and run the actual Python physics module inside a browser worker. First use downloads the runtime from jsDelivr and may take several seconds. The default presets use Python-calculated snapshot results. NHC and global vector data on Pages can be delayed by Actions scheduling or source latency.

For immediate Python calculations, the optional [Render Blueprint](render.yaml) deploys `backend.server` on a free Python web service. Once it has a public URL, add repository variable `PAL_API_BASE` with that URL and rerun the Pages workflow. Render's free service may sleep after inactivity; the snapshot and browser equation fallback keep the UI usable. The site does not require Render to publish.

