"""Boxes on the map: validation and "is this point inside?".

Every box has a `shape`. Today the only shape is a rectangle; a stored box
without `shape` is a rectangle. Callers use the shape-neutral functions
(`contains`, `area_m2`, `label_point`, `equivalent_radius`, `find_zones`,
`validate_zone`), which dispatch on the shape, so a new shape only adds its
own functions to the tables at the bottom of this module.

A rectangle is stored as its centre (lat, lon), its size in metres (width_m
along its own x axis, height_m along its y axis) and a turn (rotation_deg) in
degrees, clockwise on a north-up map. Turn 0 means the width runs east-west.

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

RECTANGLE = "rectangle"

_ID_RE = re.compile(r"[-_.A-Za-z0-9]{1,64}")
# Control, format (zero-width, bidi), line/paragraph separators, surrogates, private use, unassigned.
_BAD_CATEGORIES = {"Cc", "Cf", "Zl", "Zp", "Cs", "Co", "Cn"}


class ZoneError(ValueError):
    """A box failed validation. `field` names the bad field, if any."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


def shape_of(zone: dict[str, Any]) -> str:
    """The box's shape; a box stored without one is a rectangle."""
    return zone.get("shape") or RECTANGLE


def to_local(zone: dict[str, Any], lat: float, lon: float) -> tuple[float, float]:
    """Metres from a rectangle's centre along its own width (x) and height (y) axes."""
    east = (lon - zone["lon"]) * M_PER_DEG * math.cos(math.radians(zone["lat"]))
    north = (lat - zone["lat"]) * M_PER_DEG
    a = math.radians(zone["rotation_deg"])
    return (east * math.cos(a) - north * math.sin(a), east * math.sin(a) + north * math.cos(a))


def _rectangle_contains(zone: dict[str, Any], lat: float, lon: float) -> bool:
    x, y = to_local(zone, lat, lon)
    return (abs(x) <= zone["width_m"] / 2 + EDGE_MARGIN_M
            and abs(y) <= zone["height_m"] / 2 + EDGE_MARGIN_M)


def _rectangle_area(zone: dict[str, Any]) -> float:
    return zone["width_m"] * zone["height_m"]


def _rectangle_label_point(zone: dict[str, Any]) -> tuple[float, float]:
    return (zone["lat"], zone["lon"])


def _shape_fn(table: dict[str, Any], zone: dict[str, Any]) -> Any:
    shape = shape_of(zone)
    try:
        return table[shape]
    except KeyError:
        raise ZoneError(f"Unknown shape: {shape}", "shape") from None


def contains(zone: dict[str, Any], lat: float, lon: float) -> bool:
    """Is the point inside the box? Points on an edge count as inside."""
    return _shape_fn(_CONTAINS, zone)(zone, lat, lon)


def area_m2(zone: dict[str, Any]) -> float:
    """The box's area in square metres."""
    return _shape_fn(_AREA, zone)(zone)


def label_point(zone: dict[str, Any]) -> tuple[float, float]:
    """(lat, lon) of a point inside the box where its name goes: the middle of a rectangle."""
    return _shape_fn(_LABEL_POINT, zone)(zone)


def find_zones(zones: list[dict[str, Any]], lat: float, lon: float) -> list[dict[str, Any]]:
    """Every box the point is in, smallest area first."""
    return sorted((z for z in zones if contains(z, lat, lon)), key=area_m2)


def find_zone(zones: list[dict[str, Any]], lat: float, lon: float) -> dict[str, Any] | None:
    """The box the point is in. When boxes overlap, the smallest one wins."""
    hits = find_zones(zones, lat, lon)
    return hits[0] if hits else None


def equivalent_radius(zone: dict[str, Any]) -> float:
    """The radius of a circle with the box's area, to compare a box with round zones."""
    return math.sqrt(area_m2(zone) / math.pi)


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
    """Return a clean copy of the box, or raise ZoneError. A missing id gets a new one.

    Used on load and on save. A box without `shape` is a rectangle.
    """
    if not isinstance(obj, dict):
        raise ZoneError("A box must be an object")
    zone_id = obj.get("id") or uuid.uuid4().hex
    if not isinstance(zone_id, str) or not _ID_RE.fullmatch(zone_id):
        raise ZoneError("Invalid box id", "id")
    shape = obj.get("shape") or RECTANGLE
    validate_shape = _VALIDATE.get(shape) if isinstance(shape, str) else None
    if validate_shape is None:
        raise ZoneError("Unknown shape", "shape")
    return {"id": zone_id, "name": clean_name(obj.get("name")), "shape": shape, **validate_shape(obj)}


def _validate_rectangle(obj: dict[str, Any]) -> dict[str, Any]:
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
        "lat": lat,
        "lon": lon,
        "width_m": round(width, 2),
        "height_m": round(height, 2),
        "rotation_deg": round(rotation, 2) % 360.0,
    }


# Per-shape functions. A new shape adds an entry to each table.
_CONTAINS = {RECTANGLE: _rectangle_contains}
_AREA = {RECTANGLE: _rectangle_area}
_LABEL_POINT = {RECTANGLE: _rectangle_label_point}
_VALIDATE = {RECTANGLE: _validate_rectangle}
