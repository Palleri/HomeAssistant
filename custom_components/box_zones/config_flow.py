"""Set up Box Zones.

Each followed tracker is a sub-entry ("Tracker") of the one Box Zones entry, so
trackers are added with "Add tracker" on the integration's page (or on the
Box Zones page in the sidebar), never by adding the integration again.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryData,
    ConfigSubentryFlow,
    SubentryFlowResult,
)
from homeassistant.const import ATTR_FRIENDLY_NAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er, selector

from .const import CONF_ENTITY_ID, CONF_TRACKERS, DOMAIN, PANEL_TITLE, SUBENTRY_TRACKER


def own_entity_ids(hass: HomeAssistant) -> list[str]:
    """Our own location entities: they can't follow themselves."""
    return [e.entity_id for e in er.async_get(hass).entities.values() if e.platform == DOMAIN]


def clean_trackers(hass: HomeAssistant, trackers: list[str]) -> list[str]:
    own = set(own_entity_ids(hass))
    out: list[str] = []
    for tracker in trackers:
        if tracker.startswith("device_tracker.") and tracker not in own and tracker not in out:
            out.append(tracker)
    return out


def tracker_title(hass: HomeAssistant, entity_id: str) -> str:
    state = hass.states.get(entity_id)
    return (state and state.attributes.get(ATTR_FRIENDLY_NAME)) or entity_id


def tracker_subentry(hass: HomeAssistant, entity_id: str) -> ConfigSubentryData:
    return ConfigSubentryData(
        data={CONF_ENTITY_ID: entity_id},
        subentry_type=SUBENTRY_TRACKER,
        title=tracker_title(hass, entity_id),
        unique_id=entity_id,
    )


def followed(entry: ConfigEntry) -> list[str]:
    """The trackers the entry follows, in the order they were added."""
    return [
        sub.data[CONF_ENTITY_ID]
        for sub in entry.subentries.values()
        if sub.subentry_type == SUBENTRY_TRACKER
    ]


class BoxZonesConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1
    MINOR_VERSION = 2  # 1.1 kept the trackers in options; 1.2 has one sub-entry per tracker

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            trackers = clean_trackers(self.hass, user_input.get(CONF_TRACKERS, []))
            return self.async_create_entry(
                title=PANEL_TITLE,
                data={},
                subentries=[tracker_subentry(self.hass, t) for t in trackers],
            )
        schema = vol.Schema(
            {
                vol.Optional(CONF_TRACKERS, default=[]): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="device_tracker", multiple=True, exclude_entities=own_entity_ids(self.hass)
                    )
                )
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        return {SUBENTRY_TRACKER: TrackerSubentryFlow}


class TrackerSubentryFlow(ConfigSubentryFlow):
    """Add tracker: pick one tracker to follow."""

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        entry = self._get_entry()
        if user_input is not None:
            entity_id = user_input[CONF_ENTITY_ID]
            if entity_id in followed(entry):
                return self.async_abort(reason="already_configured")
            if not clean_trackers(self.hass, [entity_id]):
                return self.async_abort(reason="not_a_tracker")
            return self.async_create_entry(
                title=tracker_title(self.hass, entity_id),
                data={CONF_ENTITY_ID: entity_id},
                unique_id=entity_id,
            )
        schema = vol.Schema(
            {
                vol.Required(CONF_ENTITY_ID): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="device_tracker",
                        exclude_entities=own_entity_ids(self.hass) + followed(entry),
                    )
                )
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)
