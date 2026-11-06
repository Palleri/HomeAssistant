"""Print the home-assistant-frontend requirement of the installed Home Assistant.

The panel depends on Home Assistant's frontend, which the test package does
not install. CI installs exactly the version that Home Assistant pins.
"""

import json
from pathlib import Path

import homeassistant.components.frontend as frontend

manifest = json.loads((Path(frontend.__file__).parent / "manifest.json").read_text())
print(next(r for r in manifest["requirements"] if r.startswith("home-assistant-frontend")))
