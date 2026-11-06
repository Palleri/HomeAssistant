"""Box Zones: rectangular zones for Home Assistant.

Draw rotatable boxes on a map (the Box Zones page in the sidebar). For every
tracker you pick, a location entity shows the name of the box the tracker is
in, and Home Assistant's own zones (home, away, ...) when it isn't in a box.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from . import panel, websocket_api
from .const import CONF_TRACKERS, DOMAIN
from .store import ZoneStore

PLATFORMS = [Platform.DEVICE_TRACKER]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type BoxZonesConfigEntry = ConfigEntry[ZoneStore]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    websocket_api.async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: BoxZonesConfigEntry) -> bool:
    store = ZoneStore(hass)
    await store.async_load()
    store.loaded_trackers = list(entry.options.get(CONF_TRACKERS, []))
    entry.runtime_data = store
    await panel.async_register(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: BoxZonesConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        panel.async_unregister(hass)
    return unloaded


async def _async_reload(hass: HomeAssistant, entry: BoxZonesConfigEntry) -> None:
    """The tracker list changed in the options dialog: rebuild the entities.

    The Box Zones page reloads by itself and sets loaded_trackers first, so this skips it.
    """
    if entry.runtime_data.loaded_trackers != entry.options.get(CONF_TRACKERS, []):
        await hass.config_entries.async_reload(entry.entry_id)
