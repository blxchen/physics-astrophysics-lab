"""Small dependency-free API for PAL's Python cyclone model."""

from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen
from .physics import Storm, simulate

NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json"
_cache = {"at": 0.0, "data": None}
_field_cache = {}


def active_storms() -> dict:
    if _cache["data"] is not None and time.time() - _cache["at"] < 900:
        return _cache["data"]
    request = Request(NHC_URL, headers={"User-Agent": "PAL-Education/1.0"})
    with urlopen(request, timeout=8) as response:
        raw = json.load(response)
    items = []
    for row in raw.get("activeStorms", []):
        try:
            items.append({"id": row["id"], "name": row["name"],
                          "classification": row.get("classification"),
                          "latitude": float(row["latitudeNumeric"]),
                          "longitude": float(row["longitudeNumeric"]),
                          "wind_kmh": round(float(row["intensity"]) * 1.852, 1),
                          "pressure_hpa": float(row["pressure"]),
                          "heading_deg": float(row.get("movementDir") or 0),
                          "translation_kmh": round(float(row.get("movementSpeed") or 0) * 1.609344, 1),
                          "updated_at": row.get("lastUpdate")})
        except (KeyError, TypeError, ValueError):
            continue
    result = {"source": NHC_URL, "coverage": "Atlantic and eastern/central North Pacific", "storms": items}
    _cache.update(at=time.time(), data=result)
    return result


def vector_field(kind: str) -> dict:
    if kind not in ("wind", "ocean"):
        raise ValueError("Field must be wind or ocean")
    cached = _field_cache.get(kind)
    if cached and time.time() - cached["at"] < 1800:
        return cached["data"]
    latitudes = [-60, -40, -20, 0, 20, 40, 60]
    longitudes = [-150, -100, -50, 0, 50, 100, 150]
    pairs = [(lat, lon) for lat in latitudes for lon in longitudes]
    speed_key, direction_key = ("wind_speed_10m", "wind_direction_10m") if kind == "wind" else ("ocean_current_velocity", "ocean_current_direction")
    base = "https://api.open-meteo.com/v1/forecast" if kind == "wind" else "https://marine-api.open-meteo.com/v1/marine"
    query = urlencode({"latitude": ",".join(str(p[0]) for p in pairs),
                       "longitude": ",".join(str(p[1]) for p in pairs),
                       "current": f"{speed_key},{direction_key}", "forecast_days": "1", "timezone": "UTC"})
    with urlopen(Request(f"{base}?{query}", headers={"User-Agent": "PAL-Education/1.0"}), timeout=15) as response:
        raw = json.load(response)
    rows = raw if isinstance(raw, list) else [raw]
    points = []
    for row in rows:
        current = row.get("current", {})
        speed, direction = current.get(speed_key), current.get(direction_key)
        if speed is None or direction is None:
            continue
        points.append({"latitude": row["latitude"], "longitude": row["longitude"],
                       "speed_kmh": speed, "direction_deg": direction,
                       "valid_time": current.get("time")})
    result = {"kind": kind, "source": base, "grid_points": points,
              "direction_convention": "from" if kind == "wind" else "toward",
              "resolution_note": "Sparse 7x7 sampled grid; arrows do not resolve local structure"}
    _field_cache[kind] = {"at": time.time(), "data": result}
    return result


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", os.environ.get("PAL_ALLOWED_ORIGIN", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, data, status=200):
        self._headers(status)
        self.wfile.write(json.dumps(data, allow_nan=False).encode("utf-8"))

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._json({"status": "ok", "model": "python"})
        elif parsed.path == "/api/storms":
            try:
                self._json(active_storms())
            except (URLError, TimeoutError, ValueError) as exc:
                self._json({"error": "NHC feed unavailable", "detail": str(exc)}, 503)
        elif parsed.path == "/api/field":
            try:
                kind = parse_qs(parsed.query).get("kind", [""])[0]
                self._json(vector_field(kind))
            except ValueError as exc:
                self._json({"error": str(exc)}, 400)
            except (URLError, TimeoutError) as exc:
                self._json({"error": "Vector feed unavailable", "detail": str(exc)}, 503)
        else:
            self._json({"error": "Not found"}, 404)

    def do_POST(self):
        if self.path != "/api/simulate":
            return self._json({"error": "Not found"}, 404)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 20_000:
                raise ValueError("Invalid request size")
            data = json.loads(self.rfile.read(size))
            self._json(simulate(Storm.from_dict(data)))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._json({"error": str(exc)}, 400)


def main():
    port = int(os.environ.get("PORT", "8000"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

