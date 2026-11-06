"""Rotated rectangles on the map: validation and "is this point inside?".

A box is stored as its centre (lat, lon), its size in metres (width_m along
its own x axis, height_m along its y axis) and a rotation in degrees,
clockwise on a north-up map. Rotation 0 means the width runs east-west.

The maths uses a flat local plane around each box's centre, which is exact
enough for anything up to tens of kilometres. The same maths is in
frontend/geo.js, so the map shows exactly what the entities use.
"""

from __future__ import annotations

import math
import re
import unicodedata
import uuid
from typing import Any

M_PER_DEG = 111_320.0
MIN_SIZE_M = 2.0
MAX_SIZE_M = 50_000.0
MAX_ZONES = 500
NAME_MAX = 100
# Points exactly on an edge count as inside.
EDGE_MARGIN_M = 1e-6

_ID_RE = re.compile(r"[-_.A-Za-z0-9]{1,64}")
# Control, format (zero-width, bidi), line/paragraph separators, surrogates, private use, unassigned.
_BAD_CATEGORIES = {"Cc", "Cf", "Zl", "Zp", "Cs", "Co", "Cn"}


class ZoneError(ValueError):
    """A box failed validation. `field` names the bad field, if any."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


def to_local(zone: dict[str, Any], lat: float, lon: float) -> tuple[float, float]:
    """Metres from the box centre along the box's own width (x) and height (y) axes."""
    east = (lon - zone["lon"]) * M_PER_DEG * math.cos(math.radians(zone["lat"]))
    north = (lat - zone["lat"]) * M_PER_DEG
    a = math.radians(zone["rotation_deg"])
    return (east * math.cos(a) - north * math.sin(a), east * math.sin(a) + north * math.cos(a))


def contains(zone: dict[str, Any], lat: float, lon: float) -> bool:
    x, y = to_local(zone, lat, lon)
    return (abs(x) <= zone["width_m"] / 2 + EDGE_MARGIN_M
            and abs(y) <= zone["height_m"] / 2 + EDGE_MARGIN_M)


def find_zones(zones: list[dict[str, Any]], lat: float, lon: float) -> list[dict[str, Any]]:
    """Every box the point is in, smallest first."""
    return sorted((z for z in zones if contains(z, lat, lon)), key=lambda z: z["width_m"] * z["height_m"])


def find_zone(zones: list[dict[str, Any]], lat: float, lon: float) -> dict[str, Any] | None:
    """The box the point is in. When boxes overlap, the smallest one wins."""
    hits = find_zones(zones, lat, lon)
    return hits[0] if hits else None


def equivalent_radius(zone: dict[str, Any]) -> float:
    """The radius of a circle with the box's area, to compare a box with round zones."""
    return math.sqrt(zone["width_m"] * zone["height_m"] / math.pi)


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ZoneError(f"{field} must be a number", field)
    result = float(value)
    if not math.isfinite(result):
        raise ZoneError(f"{field} must be a finite number", field)
    return result


def clean_name(name: Any) -> str:
    if not isinstance(name, str) or any(unicodedata.category(c) in _BAD_CATEGORIES for c in name):
        raise ZoneError("The name can't contain control or invisible characters", "name")
    name = name.strip()
    if not 1 <= len(name) <= NAME_MAX:
        raise ZoneError(f"The name must be 1 to {NAME_MAX} characters", "name")
    return name


def validate_zone(obj: Any) -> dict[str, Any]:
    """Return a clean copy of the box, or raise ZoneError. A missing id gets a new one."""
    if not isinstance(obj, dict):
        raise ZoneError("A box must be an object")
    zone_id = obj.get("id") or uuid.uuid4().hex
    if not isinstance(zone_id, str) or not _ID_RE.fullmatch(zone_id):
        raise ZoneError("Invalid box id", "id")
    lat = _number(obj.get("lat"), "lat")
    lon = _number(obj.get("lon"), "lon")
    width = _number(obj.get("width_m"), "width_m")
    height = _number(obj.get("height_m"), "height_m")
    rotation = _number(obj.get("rotation_deg", 0), "rotation_deg") % 360.0
    if not -85 <= lat <= 85:
        raise ZoneError("Latitude must be between -85 and 85", "lat")
    if not -180 <= lon <= 180:
        raise ZoneError("Longitude must be between -180 and 180", "lon")
    for field, value in (("width_m", width), ("height_m", height)):
        if not MIN_SIZE_M <= value <= MAX_SIZE_M:
            raise ZoneError(f"Width and height must be {MIN_SIZE_M:g} to {MAX_SIZE_M:g} m", field)
    return {
        "id": zone_id,
        "name": clean_name(obj.get("name")),
        "lat": lat,
        "lon": lon,
        "width_m": round(width, 2),
        "height_m": round(height, 2),
        "rotation_deg": round(rotation, 2) % 360.0,
    }
