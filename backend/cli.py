"""Run PAL's Python cyclone model without the web interface.

python -m backend.cli --parameters storm.json --output result.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .physics import Storm, simulate


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate an idealized PAL cyclone scenario")
    parser.add_argument("--parameters", type=Path, help="JSON object of Storm parameters")
    parser.add_argument("--output", type=Path, help="write the result to this JSON file")
    args = parser.parse_args()
    try:
        values = json.loads(args.parameters.read_text(encoding="utf-8")) if args.parameters else {}
        if not isinstance(values, dict):
            raise ValueError("Parameters must be a JSON object")
        result = simulate(Storm.from_dict(values))
        output = json.dumps(result, indent=2, allow_nan=False) + "\n"
        if args.output:
            args.output.write_text(output, encoding="utf-8")
            print(f"Written {args.output}")
        else:
            print(output, end="")
    except (OSError, ValueError, TypeError) as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
