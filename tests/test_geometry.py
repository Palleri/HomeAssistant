"""Box maths: the entities and the map must agree on what is inside."""

import pytest

from custom_components.box_zones.geometry import ZoneError, contains, find_zone, validate_zone

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


@pytest.mark.parametrize("bad", [
    {"name": ""}, {"name": "a​b"}, {"width_m": 1}, {"height_m": 60_000},
    {"lat": 91}, {"lon": "x"}, {"lat": float("nan")}, {"id": "no spaces"},
])
def test_validate_rejects(bad):
    with pytest.raises(ZoneError):
        validate_zone({**BOX, **bad})
