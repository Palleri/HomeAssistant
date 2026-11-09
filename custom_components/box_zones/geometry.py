"""Boxes on the map: validation and "is this point inside?".

Every box has a `shape`: a rectangle or a polygon; a stored box without
`shape` is a rectangle. Callers use the shape-neutral functions
(`contains`, `area_m2`, `label_point`, `equivalent_radius`, `find_zones`,
`validate_zone`), which dispatch on the shape, so a new shape only adds its
own functions to the tables at the bottom of this module.

A rectangle is stored as its centre (lat, lon), its size in metres (width_m
along its own x axis, height_m along its y axis) and a turn (rotation_deg) in
degrees, clockwise on a north-up map. Turn 0 means the width runs east-west.

A polygon is stored as its corners (`points`): an ordered list of [lat, lon],
without repeating the first corner at the end. It may be concave but never
crosses itself.

The maths uses a flat local plane around each box's centre (for a polygon, the
middle of its corners' lat/lon span), which is exact enough for anything up to
tens of kilometres. The same maths is in
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
MIN_AREA_M2 = MIN_SIZE_M * MIN_SIZE_M
MIN_CORNERS = 3
MAX_CORNERS = 100
# Corners are stored to 7 decimals (about 1 cm).
CORNER_DECIMALS = 7
MAX_ZONES = 500
NAME_MAX = 100
# Points exactly on an edge count as inside.
EDGE_MARGIN_M = 1e-6

RECTANGLE = "rectangle"
POLYGON = "polygon"
CROSSING_ERROR = "The outline crosses itself"

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
    """(lat, lon) of a point inside the box where its name goes.

    The middle of a rectangle; for a polygon a point that is always inside it.
    """
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


# ------------------------------------------------------------------ polygons
# Local plane: x metres east, y metres north of the polygon's reference point.
Xy = tuple[float, float]


def _plane(points: list[list[float]]) -> tuple[float, float, float, list[Xy]]:
    """(ref_lat, ref_lon, metres per degree of longitude, corners in the local plane).

    The reference point is the middle of the corners' lat/lon span.
    """
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    ref_lat, ref_lon = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
    m_lon = M_PER_DEG * math.cos(math.radians(ref_lat))
    return ref_lat, ref_lon, m_lon, [((lon - ref_lon) * m_lon, (lat - ref_lat) * M_PER_DEG) for lat, lon in points]


def _dist_to_segment(px: float, py: float, a: Xy, b: Xy) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) if len2 else 0.0
    return math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))


def _ring_contains(xy: list[Xy], px: float, py: float) -> bool:
    """Even-odd rule. Points exactly on a side may land either way."""
    inside = False
    j = len(xy) - 1
    for i in range(len(xy)):
        (xi, yi), (xj, yj) = xy[i], xy[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _polygon_contains(zone: dict[str, Any], lat: float, lon: float) -> bool:
    ref_lat, ref_lon, m_lon, xy = _plane(zone["points"])
    px, py = (lon - ref_lon) * m_lon, (lat - ref_lat) * M_PER_DEG
    n = len(xy)
    if any(_dist_to_segment(px, py, xy[i], xy[(i + 1) % n]) <= EDGE_MARGIN_M for i in range(n)):
        return True
    return _ring_contains(xy, px, py)


def _signed_area(xy: list[Xy]) -> float:
    """Shoelace formula; positive when the corners run anticlockwise."""
    n = len(xy)
    return sum(xy[i][0] * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * xy[i][1] for i in range(n)) / 2


def _polygon_area(zone: dict[str, Any]) -> float:
    return abs(_signed_area(_plane(zone["points"])[3]))


def _polygon_label_xy(xy: list[Xy]) -> Xy:
    """A point inside the polygon: its centroid when that is inside, otherwise the
    middle of the widest stretch inside along the east-west line through the centroid."""
    n = len(xy)
    a = _signed_area(xy)
    cx = cy = 0.0
    for i in range(n):
        (x0, y0), (x1, y1) = xy[i], xy[(i + 1) % n]
        f = x0 * y1 - x1 * y0
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    cx, cy = cx / (6 * a), cy / (6 * a)
    if _ring_contains(xy, cx, cy):
        return cx, cy
    xs = []
    for i in range(n):
        (x0, y0), (x1, y1) = xy[i], xy[(i + 1) % n]
        if (y0 > cy) != (y1 > cy):
            xs.append(x0 + (cy - y0) * (x1 - x0) / (y1 - y0))
    xs.sort()
    left, right = max(((xs[k], xs[k + 1]) for k in range(0, len(xs) - 1, 2)), key=lambda s: s[1] - s[0])
    return (left + right) / 2, cy


def _polygon_label_point(zone: dict[str, Any]) -> tuple[float, float]:
    ref_lat, ref_lon, m_lon, xy = _plane(zone["points"])
    x, y = _polygon_label_xy(xy)
    return (ref_lat + y / M_PER_DEG, ref_lon + x / m_lon)


def _orient(a: Xy, b: Xy, c: Xy) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a: Xy, b: Xy, p: Xy) -> bool:
    return min(a[0], b[0]) <= p[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])


def _segments_touch(a: Xy, b: Xy, c: Xy, d: Xy) -> bool:
    """Do the sides a-b and c-d share any point (crossing or touching)?"""
    o1, o2, o3, o4 = _orient(a, b, c), _orient(a, b, d), _orient(c, d, a), _orient(c, d, b)
    if ((o1 > 0 > o2) or (o1 < 0 < o2)) and ((o3 > 0 > o4) or (o3 < 0 < o4)):
        return True
    return ((o1 == 0 and _on_segment(a, b, c)) or (o2 == 0 and _on_segment(a, b, d))
            or (o3 == 0 and _on_segment(c, d, a)) or (o4 == 0 and _on_segment(c, d, b)))


def _ring_self_intersects(xy: list[Xy]) -> bool:
    """Repeated corners, two sides that cross or touch, or a side folding back over the next."""
    n = len(xy)
    if len(set(xy)) != n:
        return True
    for i in range(n):
        a, b, c = xy[i], xy[(i + 1) % n], xy[(i + 2) % n]
        # Neighbouring sides meet only at their shared corner, never doubling back along one line.
        if _orient(a, b, c) == 0 and (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0:
            return True
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue  # the last side is next to the first
            if _segments_touch(a, b, xy[j], xy[(j + 1) % n]):
                return True
    return False


def self_intersects(points: list[list[float]]) -> bool:
    """Does the outline ([lat, lon] corners) cross or touch itself, or repeat a corner?"""
    return _ring_self_intersects(_plane(points)[3])


def _validate_polygon(obj: dict[str, Any]) -> dict[str, Any]:
    raw = obj.get("points")
    if not isinstance(raw, (list, tuple)):
        raise ZoneError("A polygon needs a list of corners", "points")
    if not MIN_CORNERS <= len(raw) <= MAX_CORNERS:
        raise ZoneError(f"A polygon must have {MIN_CORNERS} to {MAX_CORNERS} corners", "points")
    points = []
    for corner in raw:
        if not isinstance(corner, (list, tuple)) or len(corner) != 2:
            raise ZoneError("Each corner must be [latitude, longitude]", "points")
        lat, lon = _number(corner[0], "points"), _number(corner[1], "points")
        if not -85 <= lat <= 85:
            raise ZoneError("Latitude must be between -85 and 85", "points")
        if not -180 <= lon <= 180:
            raise ZoneError("Longitude must be between -180 and 180", "points")
        points.append([round(lat, CORNER_DECIMALS), round(lon, CORNER_DECIMALS)])
    xy = _plane(points)[3]
    # "Across" like a rectangle: at most the largest width and height, east-west and north-south.
    if (max(x for x, _ in xy) - min(x for x, _ in xy) > MAX_SIZE_M
            or max(y for _, y in xy) - min(y for _, y in xy) > MAX_SIZE_M):
        raise ZoneError(f"A polygon can be at most {MAX_SIZE_M / 1000:g} km across", "points")
    if _ring_self_intersects(xy):
        raise ZoneError(CROSSING_ERROR, "points")
    if abs(_signed_area(xy)) < MIN_AREA_M2:
        raise ZoneError(f"A polygon must be at least {MIN_AREA_M2:g} m²", "points")
    return {"points": points}


# Per-shape functions. A new shape adds an entry to each table.
_CONTAINS = {RECTANGLE: _rectangle_contains, POLYGON: _polygon_contains}
_AREA = {RECTANGLE: _rectangle_area, POLYGON: _polygon_area}
_LABEL_POINT = {RECTANGLE: _rectangle_label_point, POLYGON: _polygon_label_point}
_VALIDATE = {RECTANGLE: _validate_rectangle, POLYGON: _validate_polygon}
