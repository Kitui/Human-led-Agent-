from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_supplied_correlact_logo_is_a_real_png_asset():
    logo = FRONTEND / "assets" / "correlact-logo.png"
    payload = logo.read_bytes()
    assert payload.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(payload) > 1_000


def test_login_loads_final_polish_layer_after_theme_boot():
    login_source = (FRONTEND / "js" / "login-view.js").read_text(encoding="utf-8")
    assert 'link.href = "/correlact-fixes.css"' in login_source
    assert "ensureLoginPolishStyles();" in login_source


def test_polish_layer_uses_supplied_logo_and_prevents_recorded_flicker_overlap():
    css = (FRONTEND / "correlact-fixes.css").read_text(encoding="utf-8")
    assert "url('/assets/correlact-logo.png')" in css
    assert ".topbar .logo svg { display: none !important; }" in css
    assert ".topbar .brand { display: none !important; }" in css
    assert "input:-webkit-autofill" in css
    assert "-webkit-text-fill-color: #f5f7fb" in css
    assert "0 0 0 1000px #091727 inset" in css
    assert "#login-error.hidden" in css
    assert "@media (min-width: 981px) and (max-height: 820px)" in css
    assert "@media (min-width: 981px) and (max-height: 700px)" in css
