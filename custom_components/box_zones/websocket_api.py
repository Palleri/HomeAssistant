"""WebSocket commands used by the Box Zones page. Admin only."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .config_flow import clean_trackers
from .const import CONF_TRACKERS, DOMAIN, VERSION
from .geometry import MAX_SIZE_M, MIN_SIZE_M, ZoneError
from .store import ZoneStore


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_save_zone)
    websocket_api.async_register_command(hass, ws_delete_zone)
    websocket_api.async_register_command(hass, ws_set_trackers)


def _entry(hass: HomeAssistant) -> ConfigEntry | None:
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED and isinstance(entry.runtime_data, ZoneStore):
            return entry
    return None


def _payload(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    registry = er.async_get(hass)
    trackers = [
        {"source": source, "entity_id": registry.async_get_entity_id("device_tracker", DOMAIN, source)}
        for source in entry.options.get(CONF_TRACKERS, [])
    ]
    return {
        "version": VERSION,
        "zones": entry.runtime_data.zones,
        "trackers": trackers,
        "limits": {"min_size_m": MIN_SIZE_M, "max_size_m": MAX_SIZE_M},
    }


def _not_ready(connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_error(msg["id"], "not_ready", "Box Zones is not loaded. Check Settings → Devices & services.")


@websocket_api.websocket_command({vol.Required("type"): "box_zones/get"})
@websocket_api.require_admin
@callback
def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        _not_ready(connection, msg)
        return
    connection.send_result(msg["id"], _payload(hass, entry))


@websocket_api.websocket_command({vol.Required("type"): "box_zones/save_zone", vol.Required("zone"): dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_zone(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        _not_ready(connection, msg)
        return
    try:
        zone = await entry.runtime_data.async_upsert(msg["zone"])
    except ZoneError as err:
        connection.send_error(msg["id"], "invalid_zone", str(err))
        return
    connection.send_result(msg["id"], {"zone": zone, **_payload(hass, entry)})


@websocket_api.websocket_command({vol.Required("type"): "box_zones/delete_zone", vol.Required("zone_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_zone(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        _not_ready(connection, msg)
        return
    try:
        await entry.runtime_data.async_delete(msg["zone_id"])
    except ZoneError as err:
        connection.send_error(msg["id"], "not_found", str(err))
        return
    connection.send_result(msg["id"], _payload(hass, entry))


@websocket_api.websocket_command({vol.Required("type"): "box_zones/set_trackers", vol.Required("trackers"): [str]})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_trackers(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        _not_ready(connection, msg)
        return
    trackers = clean_trackers(hass, msg["trackers"])
    # Reload here (not in the update listener) so the new entities exist when we answer.
    entry.runtime_data.loaded_trackers = trackers
    hass.config_entries.async_update_entry(entry, options={**entry.options, CONF_TRACKERS: trackers})
    await hass.config_entries.async_reload(entry.entry_id)
    entry = _entry(hass)
    if entry is None:
        _not_ready(connection, msg)
        return
    connection.send_result(msg["id"], _payload(hass, entry))
