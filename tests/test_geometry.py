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
