"""Idealized Holland-type tropical cyclone fields in SI units.

The model is axisymmetric over open water. It has no land interaction,
boundary-layer solver, bathymetry, or forecast skill. See README for equations.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import asin, atan2, cos, exp, hypot, isfinite, pi, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000.0
AIR_DENSITY_KG_M3 = 1.15
EARTH_OMEGA_RAD_S = 7.2921159e-5
SURFACE_REDUCTION = 0.9


@dataclass(frozen=True)
class Storm:
    latitude: float = 18.8
    longitude: float = 126.2
    maximum_wind_kmh: float = 184.0
    central_pressure_hpa: float = 942.0
    ambient_pressure_hpa: float = 1010.0
    radius_max_wind_km: float = 38.0
    translation_kmh: float = 22.0
    heading_deg: float = 315.0
    sea_temperature_c: float = 29.4
    exposed_assets_usd: float = 0.0

    @classmethod
    def from_dict(cls, data: dict) -> "Storm":
        aliases = {
            "lat": "latitude", "lon": "longitude", "wind": "maximum_wind_kmh",
            "pressure": "central_pressure_hpa", "seaTemp": "sea_temperature_c",
            "speed": "translation_kmh", "rmax": "radius_max_wind_km",
            "assets": "exposed_assets_usd",
        }
        values = {aliases.get(k, k): v for k, v in data.items()}
        allowed = cls.__dataclass_fields__
        obj = cls(**{k: float(v) for k, v in values.items() if k in allowed})
        if not all(isfinite(getattr(obj, k)) for k in allowed):
            raise ValueError("All numeric parameters must be finite")
        if not -60 <= obj.latitude <= 60 or not -180 <= obj.longitude <= 180:
            raise ValueError("Storm center must lie within 60° of the equator")
        if not 0 < obj.maximum_wind_kmh <= 350:
            raise ValueError("Wind must be between 0 and 350 km/h")
        if not 850 <= obj.central_pressure_hpa < obj.ambient_pressure_hpa <= 1050:
            raise ValueError("Central pressure must be below ambient pressure")
        if not 5 <= obj.radius_max_wind_km <= 200:
            raise ValueError("Radius of maximum wind must be 5–200 km")
        if not 0 <= obj.translation_kmh <= 100 or not 0 <= obj.heading_deg <= 360:
            raise ValueError("Invalid motion parameters")
        if not 20 <= obj.sea_temperature_c <= 35 or obj.exposed_assets_usd < 0:
            raise ValueError("Invalid sea temperature or exposure")
        return obj


def coriolis(latitude_deg: float) -> float:
    return 2 * EARTH_OMEGA_RAD_S * sin(radians(latitude_deg))


def holland_b(storm: Storm) -> tuple[float, bool]:
    """Infer the Holland shape factor from peak 10 m wind and pressure deficit.

    At Rmax, gradient balance gives Vg² + f R Vg = B Δp/(ρ e).
    Vg = V10 / 0.9 is an assumed surface-to-gradient conversion.
    """
    vg = storm.maximum_wind_kmh / 3.6 / SURFACE_REDUCTION
    f = abs(coriolis(storm.latitude))
    r = storm.radius_max_wind_km * 1000
    dp = (storm.ambient_pressure_hpa - storm.central_pressure_hpa) * 100
    inferred = AIR_DENSITY_KG_M3 * 2.718281828459045 * (vg * vg + f * r * vg) / dp
    bounded = max(0.5, min(3.5, inferred))
    return bounded, abs(bounded - inferred) > 1e-9


def pressure_hpa(storm: Storm, radius_km: float, b: float) -> float:
    if radius_km <= 0:
        return storm.central_pressure_hpa
    x = (storm.radius_max_wind_km / radius_km) ** b
    return storm.central_pressure_hpa + (storm.ambient_pressure_hpa - storm.central_pressure_hpa) * exp(-x)


def tangential_wind_ms(storm: Storm, radius_km: float, b: float) -> float:
    if radius_km <= 0:
        return 0.0
    r = radius_km * 1000
    x = (storm.radius_max_wind_km / radius_km) ** b
    dp = (storm.ambient_pressure_hpa - storm.central_pressure_hpa) * 100
    f = abs(coriolis(storm.latitude))
    gradient = sqrt(max(0.0, b * dp / AIR_DENSITY_KG_M3 * x * exp(-x) + (f * r / 2) ** 2)) - f * r / 2
    return SURFACE_REDUCTION * gradient


def wind_vector_ms(storm: Storm, east_km: float, north_km: float, b: float) -> tuple[float, float]:
    radius = hypot(east_km, north_km)
    if radius < 0.001:
        return 0.0, 0.0
    speed = tangential_wind_ms(storm, radius, b)
    sign = 1 if storm.latitude >= 0 else -1
    # Rotate the velocity 18° inward while preserving its modeled magnitude.
    crossing = radians(18)
    u = -sign * speed * cos(crossing) * north_km / radius - speed * sin(crossing) * east_km / radius
    v = sign * speed * cos(crossing) * east_km / radius - speed * sin(crossing) * north_km / radius
    return u, v


def outer_wind_radius_km(profile: list[dict], threshold_kmh: float) -> float | None:
    """Outer crossing of a wind threshold in the sampled radial profile."""
    for inner, outer in reversed(list(zip(profile, profile[1:]))):
        a, b = inner["wind_kmh"], outer["wind_kmh"]
        if a >= threshold_kmh > b:
            fraction = (threshold_kmh - b) / (a - b)
            return round(outer["radius_km"] + fraction * (inner["radius_km"] - outer["radius_km"]), 1)
    return None


def destination(latitude: float, longitude: float, bearing_deg: float, distance_km: float) -> tuple[float, float]:
    """Great-circle direct problem on a spherical Earth."""
    phi = radians(latitude)
    lam = radians(longitude)
    bearing = radians(bearing_deg)
    delta = distance_km * 1000 / EARTH_RADIUS_M
    lat2 = asin(sin(phi) * cos(delta) + cos(phi) * sin(delta) * cos(bearing))
    lon2 = lam + atan2(sin(bearing) * sin(delta) * cos(phi), cos(delta) - sin(phi) * sin(lat2))
    return lat2 * 180 / pi, ((lon2 * 180 / pi + 180) % 360) - 180


def loss_sensitivity(storm: Storm, peak_wind_kmh: float) -> dict:
    """User-exposure sensitivity only; no location-specific vulnerability data."""
    if storm.exposed_assets_usd == 0:
        return {"status": "exposure_required", "estimated_loss_usd": None, "loss_fraction": None}
    # Saturating vulnerability curve; parameters are stated, not calibrated.
    excess = max(0.0, peak_wind_kmh - 90.0)
    fraction = 0.35 * (1 - exp(-(excess / 100.0) ** 3))
    return {"status": "illustrative", "estimated_loss_usd": storm.exposed_assets_usd * fraction, "loss_fraction": fraction}


def simulate(storm: Storm) -> dict:
    b, capped = holland_b(storm)
    radii = sorted(set([0, 2, storm.radius_max_wind_km] + list(range(5, 501, 5))))
    profile = []
    dp = (storm.ambient_pressure_hpa - storm.central_pressure_hpa) * 100
    for r in radii:
        wind = tangential_wind_ms(storm, r, b)
        x = (storm.radius_max_wind_km / r) ** b if r else 0
        gradient = dp * exp(-x) * b * x / r if r else 0  # Pa/km
        delta = min(0.5, r / 2) if r else 0
        vorticity = ((r + delta) * tangential_wind_ms(storm, r + delta, b)
                     - (r - delta) * tangential_wind_ms(storm, r - delta, b)) / (2 * delta * r * 1000) if r else 0
        profile.append({"radius_km": r, "wind_kmh": round(wind * 3.6, 2),
                        "pressure_hpa": round(pressure_hpa(storm, r, b), 2),
                        "pressure_gradient_pa_km": round(gradient, 2),
                        "wind_energy_j_m3": round(0.5 * AIR_DENSITY_KG_M3 * wind * wind, 2),
                        "wind_power_w_m2": round(0.5 * AIR_DENSITY_KG_M3 * wind ** 3, 2),
                        "vorticity_1e5_s": round((1 if storm.latitude >= 0 else -1) * vorticity * 1e5, 3)})
    track = []
    for h in range(0, 73, 3):
        lat, lon = destination(storm.latitude, storm.longitude, storm.heading_deg, storm.translation_kmh * h)
        track.append({"hour": h, "latitude": round(lat, 5), "longitude": round(lon, 5)})
    max_model_wind = max(p["wind_kmh"] for p in profile)
    heading = radians(storm.heading_deg)
    motion_east = 0.5 * storm.translation_kmh / 3.6 * sin(heading)
    motion_north = 0.5 * storm.translation_kmh / 3.6 * cos(heading)
    azimuthal = []
    for bearing in range(0, 361, 5):
        angle = radians(bearing)
        east = storm.radius_max_wind_km * sin(angle)
        north = storm.radius_max_wind_km * cos(angle)
        u, v = wind_vector_ms(storm, east, north, b)
        azimuthal.append({"bearing_deg": bearing,
                          "wind_kmh": round(hypot(u + motion_east, v + motion_north) * 3.6, 2)})
    return {
        "model": "Holland-type axisymmetric gradient wind; idealized open-water scenario",
        "inputs": storm.__dict__, "shape_parameter_b": round(b, 4),
        "shape_parameter_limited": capped,
        "radial_profile": profile, "track": track,
        "azimuthal_profile": azimuthal,
        "wind_radii_km": {"34kt": outer_wind_radius_km(profile, 34 * 1.852),
                          "50kt": outer_wind_radius_km(profile, 50 * 1.852),
                          "64kt": outer_wind_radius_km(profile, 64 * 1.852)},
        "peak_profile_wind_kmh": round(max_model_wind, 2),
        "loss": loss_sensitivity(storm, max_model_wind),
        "limitations": ["Not a weather forecast", "No land interaction or terrain", "No bathymetry or calibrated rainfall", "Translation asymmetry uses an assumed half-speed vector", "Economic loss requires user exposure"],
    }

