"""Set up Box Zones: pick the trackers to follow (can be changed later)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er, selector

from .const import CONF_TRACKERS, DOMAIN, PANEL_TITLE


def own_entity_ids(hass: HomeAssistant) -> list[str]:
    """Our own location entities: they can't follow themselves."""
    return [e.entity_id for e in er.async_get(hass).entities.values() if e.platform == DOMAIN]


def trackers_schema(hass: HomeAssistant, current: list[str]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Optional(CONF_TRACKERS, default=current): selector.EntitySelector(
                selector.EntitySelectorConfig(
                    domain="device_tracker",
                    multiple=True,
                    exclude_entities=own_entity_ids(hass),
                )
            )
        }
    )


def clean_trackers(hass: HomeAssistant, trackers: list[str]) -> list[str]:
    own = set(own_entity_ids(hass))
    out: list[str] = []
    for tracker in trackers:
        if tracker.startswith("device_tracker.") and tracker not in own and tracker not in out:
            out.append(tracker)
    return out


class BoxZonesConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            trackers = clean_trackers(self.hass, user_input.get(CONF_TRACKERS, []))
            return self.async_create_entry(title=PANEL_TITLE, data={}, options={CONF_TRACKERS: trackers})
        return self.async_show_form(step_id="user", data_schema=trackers_schema(self.hass, []))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return BoxZonesOptionsFlow()


class BoxZonesOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            trackers = clean_trackers(self.hass, user_input.get(CONF_TRACKERS, []))
            return self.async_create_entry(data={CONF_TRACKERS: trackers})
        current = self.config_entry.options.get(CONF_TRACKERS, [])
        return self.async_show_form(step_id="init", data_schema=trackers_schema(self.hass, current))
