"""The version is in two places; a release needs them to agree."""

import json
from pathlib import Path

from custom_components.box_zones.const import VERSION


def test_manifest_and_const_agree() -> None:
    manifest = Path(__file__).parents[1] / "custom_components" / "box_zones" / "manifest.json"
    assert json.loads(manifest.read_text())["version"] == VERSION
