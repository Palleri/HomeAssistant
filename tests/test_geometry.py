"""Box maths: the entities and the map must agree on what is inside."""

import math

import pytest

from custom_components.box_zones.geometry import (
    ZoneError,
    area_m2,
    contains,
    equivalent_radius,
    find_zone,
    label_point,
    self_intersects,
    shape_of,
    validate_zone,
)

BOX = {"id": "b", "name": "Parking", "lat": 52.5163, "lon": 13.3777, "width_m": 100, "height_m": 40, "rotation_deg": 0}
M_LAT = 1 / 111_320  # one metre north


def test_centre_and_edges():
    assert contains(BOX, BOX["lat"], BOX["lon"])
    assert contains(BOX, BOX["lat"] + 19.9 * M_LAT, BOX["lon"])
    assert not contains(BOX, BOX["lat"] + 20.5 * M_LAT, BOX["lon"])


def test_rotation_turns_the_box():
    turned = {**BOX, "rotation_deg": 90}  # now 100 m north-south, 40 m east-west
    assert contains(turned, BOX["lat"] + 45 * M_LAT, BOX["lon"])
    assert not contains(BOX, BOX["lat"] + 45 * M_LAT, BOX["lon"])


def test_smallest_overlapping_box_wins():
    big = {**BOX, "id": "big", "name": "Area", "width_m": 1000, "height_m": 1000}
    assert find_zone([big, BOX], BOX["lat"], BOX["lon"])["name"] == "Parking"
    assert find_zone([big, BOX], BOX["lat"] + 100 * M_LAT, BOX["lon"])["name"] == "Area"
    assert find_zone([BOX], 0, 0) is None


def test_validate_cleans_and_fills_in():
    z = validate_zone({**BOX, "id": None, "name": "  Parking  ", "rotation_deg": -90})
    assert z["name"] == "Parking" and z["rotation_deg"] == 270 and len(z["id"]) == 32


def test_a_box_without_shape_is_a_rectangle():
    assert shape_of(BOX) == "rectangle"
    z = validate_zone(BOX)
    assert z["shape"] == "rectangle"
    assert {k: z[k] for k in BOX} == BOX  # every field kept as it was


def test_area_and_label_point_of_a_rectangle():
    assert area_m2(BOX) == 4000
    assert label_point(BOX) == (BOX["lat"], BOX["lon"])
    assert contains(BOX, *label_point(BOX))
    assert equivalent_radius(BOX) == pytest.approx(math.sqrt(4000 / math.pi))


def test_smallest_area_wins_not_the_narrowest():
    long = {**BOX, "id": "long", "name": "Lane", "width_m": 1000, "height_m": 3}  # 3000 m²
    assert find_zone([BOX, long], BOX["lat"], BOX["lon"])["name"] == "Lane"


def test_unknown_shape():
    with pytest.raises(ZoneError) as err:
        validate_zone({**BOX, "shape": "blob"})
    assert err.value.field == "shape"
    with pytest.raises(ZoneError):
        contains({**BOX, "shape": "blob"}, BOX["lat"], BOX["lon"])


@pytest.mark.parametrize("bad", [
    {"name": ""}, {"name": "a​b"}, {"width_m": 1}, {"height_m": 60_000},
    {"lat": 91}, {"lon": "x"}, {"lat": float("nan")}, {"id": "no spaces"},
    {"shape": 3},
])
def test_validate_rejects(bad):
    with pytest.raises(ZoneError):
        validate_zone({**BOX, **bad})


# ------------------------------------------------------------------ polygons
M_LON = 1 / (111_320 * math.cos(math.radians(BOX["lat"])))  # one metre east, near BOX


def at(x: float, y: float) -> list[float]:
    """[lat, lon] x metres east and y metres north of BOX's centre."""
    return [BOX["lat"] + y * M_LAT, BOX["lon"] + x * M_LON]


def polygon(*xy: tuple[float, float], name: str = "Garden") -> dict:
    return {"id": "p", "name": name, "shape": "polygon", "points": [at(x, y) for x, y in xy]}


SQUARE = polygon((0, 0), (40, 0), (40, 40), (0, 40))
# An L: 40 m × 40 m with the north-east 20 m × 20 m quarter cut out (the notch).
ELL = polygon((0, 0), (40, 0), (40, 20), (20, 20), (20, 40), (0, 40))
# A U opening north; its centroid falls in the notch.
YOU = polygon((0, 0), (60, 0), (60, 40), (40, 40), (40, 10), (20, 10), (20, 40), (0, 40))


def test_polygon_contains_convex():
    assert contains(SQUARE, *at(20, 20))
    assert contains(SQUARE, *at(39.9, 0.1))
    assert not contains(SQUARE, *at(40.5, 20))
    assert not contains(SQUARE, *at(20, -0.5))


def test_polygon_contains_concave():
    assert contains(ELL, *at(10, 30))  # in the upright of the L
    assert contains(ELL, *at(30, 10))  # in its foot
    assert not contains(ELL, *at(30, 30))  # in the notch
    assert contains(YOU, *at(10, 35)) and contains(YOU, *at(50, 35))
    assert not contains(YOU, *at(30, 30))


def test_polygon_points_on_a_side_or_corner_are_inside():
    p = ELL["points"]
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        assert contains(ELL, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), f"side {i}"
        assert contains(ELL, *a), f"corner {i}"


def test_polygon_area_and_radius():
    assert area_m2(SQUARE) == pytest.approx(1600, rel=1e-4)
    assert area_m2(ELL) == pytest.approx(1200, rel=1e-4)
    assert area_m2(YOU) == pytest.approx(1800, rel=1e-4)
    # The corners' order (clockwise or not) doesn't matter.
    assert area_m2({**ELL, "points": ELL["points"][::-1]}) == pytest.approx(area_m2(ELL))
    assert equivalent_radius(ELL) == pytest.approx(math.sqrt(area_m2(ELL) / math.pi))


def test_polygon_label_point_is_inside():
    for poly in (SQUARE, ELL, YOU):
        assert contains(poly, *label_point(poly))
    assert label_point(SQUARE) == pytest.approx(at(20, 20), abs=1e-9)  # the middle when it is inside
    # The U's middle is in its notch: the label goes into one of its arms instead, at the same height.
    assert not contains(YOU, *at(30, 18.33))
    assert label_point(YOU)[0] == pytest.approx(at(0, 18.33)[0], abs=0.1 * M_LAT)


def test_smallest_area_wins_across_shapes():
    big = {**BOX, "id": "big", "name": "Plot", "width_m": 1000, "height_m": 1000}
    assert find_zone([big, ELL], *at(10, 10))["name"] == "Garden"
    assert find_zone([big, ELL], *at(30, 30))["name"] == "Plot"


def test_validate_polygon_cleans():
    z = validate_zone({**ELL, "lat": 1, "width_m": 5, "points": [tuple(p) for p in ELL["points"]]})
    assert z["shape"] == "polygon" and set(z) == {"id", "name", "shape", "points"}
    assert all(isinstance(p, list) and len(p) == 2 for p in z["points"])
    assert z["points"][1] == [round(c, 7) for c in ELL["points"][1]]


def test_self_intersects():
    assert not self_intersects(ELL["points"])
    assert not self_intersects(YOU["points"])
    assert self_intersects([at(0, 0), at(10, 10), at(10, 0), at(0, 10)])  # a bow tie
    assert self_intersects([*SQUARE["points"], SQUARE["points"][0]])  # first corner repeated
    assert self_intersects([at(0, 0), at(20, 0), at(10, 0), at(10, 10)])  # folds back on itself
    assert self_intersects([at(0, 0), at(20, 0), at(20, 20), at(10, 0), at(0, 20)])  # corner on a side


def ring(n: int, r: float = 100) -> list[list[float]]:
    return [at(math.cos(k / n * 2 * math.pi) * r, math.sin(k / n * 2 * math.pi) * r) for k in range(n)]


@pytest.mark.parametrize(("points", "message"), [
    ([at(0, 0), at(10, 10), at(10, 0), at(0, 10)], "The outline crosses itself"),
    ([at(0, 0), at(10, 0)], "3 to 100 corners"),
    (ring(101), "3 to 100 corners"),
    ([at(0, 0), at(1.5, 0), at(1.5, 1.5), at(0, 1.5)], "at least 4 m²"),
    ([at(0, 0), at(60_000, 0), at(60_000, 10)], "50 km across"),
    ([at(0, 0), at(0, 60_000), at(10, 60_000)], "50 km across"),
    ([[0, 0], [0, 1e-4], [91, 0]], "Latitude"),
    ([[0, 0], [0, 1e-4], [0, 181]], "Longitude"),
    ([[0, 0], [0, 1e-4], [0, "x"]], "number"),
    ([[0, 0], [0, 1e-4], [0, float("inf")]], "finite"),
    ([[0, 0], [0, 1e-4], [0]], "Each corner"),
    (None, "list of corners"),
])
def test_validate_polygon_rejects(points, message):
    with pytest.raises(ZoneError, match=message) as err:
        validate_zone({**ELL, "points": points})
    assert err.value.field == "points"


def test_hundred_corners_is_allowed():
    assert len(validate_zone({**ELL, "points": ring(100)})["points"]) == 100
