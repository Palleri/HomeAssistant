"""Box Zones inside a real Home Assistant."""

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.box_zones.const import CONF_TRACKERS, DOMAIN

CAR = "device_tracker.car"
OURS = "device_tracker.car_box_zones"
BOX = {"name": "Parking", "lat": 52.5163, "lon": 13.3777, "width_m": 100, "height_m": 40, "rotation_deg": 0}
HOME = (52.5200, 13.4050)


def car_at(hass: HomeAssistant, lat: float, lon: float, **extra) -> None:
    hass.states.async_set(CAR, "not_home", {"latitude": lat, "longitude": lon, "gps_accuracy": 5,
                                            "friendly_name": "Car", **extra})


async def setup(hass: HomeAssistant, trackers=(CAR,)) -> MockConfigEntry:
    hass.config.latitude, hass.config.longitude = HOME
    assert await async_setup_component(hass, "zone", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Box Zones", data={}, options={CONF_TRACKERS: list(trackers)})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_config_flow_creates_entry(hass: HomeAssistant) -> None:
    car_at(hass, 0, 0)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_TRACKERS: [CAR]})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["options"] == {CONF_TRACKERS: [CAR]}
    await hass.async_block_till_done()
    assert hass.states.get(OURS) is not None
    # Only one Box Zones can be set up.
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT


async def test_state_follows_boxes_and_zones(hass: HomeAssistant, hass_ws_client) -> None:
    car_at(hass, 52.5163, 13.3777)
    await setup(hass)
    assert hass.states.get(OURS).state == "not_home"  # no boxes yet

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "box_zones/save_zone", "zone": BOX})
    msg = await client.receive_json()
    assert msg["success"], msg
    zone_id = msg["result"]["zone"]["id"]
    await hass.async_block_till_done()
    state = hass.states.get(OURS)
    assert state.state == "Parking"
    assert state.attributes["box_zone"] == "Parking"
    assert state.attributes["box_zone_id"] == zone_id
    assert state.attributes["source_entity"] == CAR
    assert state.attributes["latitude"] == 52.5163
    assert state.attributes["friendly_name"] == "Car (Box Zones)"

    # Drive home: Home Assistant's own zone takes over.
    car_at(hass, *HOME)
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "home"
    assert hass.states.get(OURS).attributes["box_zone"] is None

    car_at(hass, 52.5163, 13.3777)
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "Parking"

    # Renaming the box updates the entity at once.
    await client.send_json_auto_id({"type": "box_zones/save_zone", "zone": {**BOX, "id": zone_id, "name": "Parking spot"}})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "Parking spot"

    await client.send_json_auto_id({"type": "box_zones/delete_zone", "zone_id": zone_id})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["zones"] == []
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "not_home"


async def test_unavailable_source(hass: HomeAssistant) -> None:
    await setup(hass)
    assert hass.states.get(OURS).state == "unavailable"  # the car isn't there yet
    car_at(hass, 1, 1)
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "not_home"
    hass.states.async_set(CAR, "unavailable", {})
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "unavailable"


async def test_tracker_without_gps_passes_through(hass: HomeAssistant) -> None:
    hass.states.async_set(CAR, "home", {"source_type": "router"})
    await setup(hass)
    assert hass.states.get(OURS).state == "home"


async def test_boxes_survive_a_restart(hass: HomeAssistant, hass_ws_client) -> None:
    car_at(hass, 52.5163, 13.3777)
    entry = await setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "box_zones/save_zone", "zone": BOX})
    assert (await client.receive_json())["success"]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "Parking"


async def test_page_changes_trackers(hass: HomeAssistant, hass_ws_client) -> None:
    car_at(hass, 1, 1)
    hass.states.async_set("device_tracker.phone", "home", {"latitude": 2, "longitude": 2})
    await setup(hass, trackers=())
    assert hass.states.get(OURS) is None

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "box_zones/set_trackers", "trackers": [CAR, "device_tracker.phone", "light.x"]})
    msg = await client.receive_json()
    assert msg["success"], msg
    assert [t["source"] for t in msg["result"]["trackers"]] == [CAR, "device_tracker.phone"]
    assert msg["result"]["trackers"][0]["entity_id"] == OURS
    await hass.async_block_till_done()
    assert hass.states.get(OURS).state == "not_home"
    assert hass.states.get("device_tracker.phone_box_zones") is not None

    # Our own entities can't be followed.
    await client.send_json_auto_id({"type": "box_zones/set_trackers", "trackers": [OURS]})
    msg = await client.receive_json()
    assert msg["result"]["trackers"] == []


async def test_bad_box_is_refused(hass: HomeAssistant, hass_ws_client) -> None:
    await setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "box_zones/save_zone", "zone": {**BOX, "width_m": 0}})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "invalid_zone"


async def test_panel_registered_and_removed(hass: HomeAssistant) -> None:
    entry = await setup(hass)
    assert "box-zones" in hass.data["frontend_panels"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "box-zones" not in hass.data["frontend_panels"]
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert "box-zones" in hass.data["frontend_panels"]


async def test_unfollowed_tracker_entity_is_removed(hass: HomeAssistant, hass_ws_client) -> None:
    car_at(hass, 1, 1)
    await setup(hass)
    assert hass.states.get(OURS) is not None
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "box_zones/set_trackers", "trackers": []})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert hass.states.get(OURS) is None
    from homeassistant.helpers import entity_registry as er
    assert er.async_get(hass).async_get(OURS) is None
