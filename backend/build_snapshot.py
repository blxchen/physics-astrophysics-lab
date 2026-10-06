"""Produce timestamped Python-calculated data for the static GitHub Pages site."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .physics import Storm, simulate
from .server import active_storms, vector_field

PRESETS = {
    "pacific": dict(latitude=18.8, longitude=126.2, maximum_wind_kmh=184,
                    central_pressure_hpa=942, radius_max_wind_km=38,
                    translation_kmh=22, heading_deg=315, sea_temperature_c=29.4),
    "atlantic": dict(latitude=22.3, longitude=-68.7, maximum_wind_kmh=156,
                     central_pressure_hpa=958, radius_max_wind_km=44,
                     translation_kmh=19, heading_deg=305, sea_temperature_c=28.7),
    "indian": dict(latitude=16.5, longitude=87.2, maximum_wind_kmh=132,
                   central_pressure_hpa=972, radius_max_wind_km=52,
                   translation_kmh=14, heading_deg=330, sea_temperature_c=30.1),
}


def main() -> None:
    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "calculation_engine": "Python backend.physics",
        "storms": [], "fields": {}, "presets": {}, "feed_errors": {},
    }
    for key, values in PRESETS.items():
        snapshot["presets"][key] = simulate(Storm.from_dict(values))
    try:
        snapshot["storms"] = active_storms()["storms"]
    except Exception as exc:  # One external feed should not block site publication.
        snapshot["feed_errors"]["nhc"] = str(exc)
    for kind in ("wind", "ocean"):
        try:
            snapshot["fields"][kind] = vector_field(kind)
        except Exception as exc:
            snapshot["feed_errors"][kind] = str(exc)
    output = Path("public/data/snapshot.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output} at {snapshot['generated_at']} with {len(snapshot['storms'])} NHC storms")


if __name__ == "__main__":
    main()

