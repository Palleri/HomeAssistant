"""The saved boxes (in .storage/box_zones.zones)."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import SIGNAL_ZONES_UPDATED, STORAGE_KEY, STORAGE_VERSION
from .geometry import MAX_ZONES, ZoneError, validate_zone


class _BoxStore(Store[dict[str, Any]]):
    """The storage file, with migrations from older major versions."""

    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: dict[str, Any]
    ) -> dict[str, Any]:
        # 1 -> 2: the data stays as it is; a box without `shape` is a rectangle.
        # The major bump only stops older Box Zones from loading boxes they can't read.
        if old_major_version == 1:
            return old_data
        # Saved by a newer Box Zones (a higher major version): Home Assistant re-raises
        # this, so setup fails and the file is left untouched (ADR 0001). A newer minor
        # version of our own major version still loads as it is.
        raise NotImplementedError


class ZoneStore:
    """Loads, changes and saves the box list and tells the entities about changes."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = _BoxStore(hass, STORAGE_VERSION, STORAGE_KEY)
        self.zones: list[dict[str, Any]] = []
        # The trackers the entities were created for (see __init__._async_reload).
        self.loaded_trackers: list[str] = []
        # Last known position of each followed tracker: (name, lat, lon), or None.
        self.positions: dict[str, tuple[str, float, float] | None] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        zones = []
        for raw in data.get("zones", []):
            try:
                zones.append(validate_zone(raw))
            except ZoneError:
                continue  # never let one bad box stop the integration
        self.zones = zones

    async def async_upsert(self, raw: Any) -> dict[str, Any]:
        zone = validate_zone(raw)
        zones = list(self.zones)
        for i, existing in enumerate(zones):
            if existing["id"] == zone["id"]:
                zones[i] = zone
                break
        else:
            if len(zones) >= MAX_ZONES:
                raise ZoneError(f"At most {MAX_ZONES} boxes")
            zones.append(zone)
        await self._async_save(zones)
        return zone

    async def async_delete(self, zone_id: str) -> None:
        zones = [z for z in self.zones if z["id"] != zone_id]
        if len(zones) == len(self.zones):
            raise ZoneError("That box doesn't exist", "id")
        await self._async_save(zones)

    async def _async_save(self, zones: list[dict[str, Any]]) -> None:
        await self._store.async_save({"zones": zones})
        self.zones = zones
        self._notify()

    @callback
    def _notify(self) -> None:
        async_dispatcher_send(self.hass, SIGNAL_ZONES_UPDATED)
