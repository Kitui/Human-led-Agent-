from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "frontend" / "js"
SETTINGS_UX = JS / "settings-ux.js"
MAIN_JS = JS / "main.js"


def test_settings_cards_have_real_interactions():
    source = SETTINGS_UX.read_text(encoding="utf-8")

    assert "Refresh status" in source
    assert '"#approvals"' in source
    assert '"#traces"' in source
    assert '"#evals"' in source
    assert "Session scope" in source
    assert "View runs" in source
    assert "renderSettingsPage()" in source


def test_settings_layout_wraps_with_available_content_width():
    source = SETTINGS_UX.read_text(encoding="utf-8")

    assert "repeat(auto-fit" in source
    assert "minmax(min(100%, 310px), 1fr)" in source
    assert "min-width: 0" in source
    assert "overflow-x: auto" in source
    assert "#settings-section-tenants .table-scroll" in source
    assert ".settings-access-note > span:last-child" in source


def test_settings_interaction_layer_is_wired_into_router():
    source = MAIN_JS.read_text(encoding="utf-8")

    assert 'import { enhanceSettingsPage } from "./settings-ux.js";' in source
    assert 'if (page === "settings")' in source
    assert "Promise.resolve(renderResult).then(enhanceSettingsPage)" in source


def test_settings_interaction_javascript_parses():
    node = shutil.which("node")
    if node is None:
        return

    for path in (SETTINGS_UX, MAIN_JS):
        subprocess.run(
            [node, "--check", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
