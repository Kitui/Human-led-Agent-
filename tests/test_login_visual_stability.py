from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_supplied_correlact_logo_is_a_real_png_asset():
    logo = FRONTEND / "assets" / "correlact-logo.png"
    payload = logo.read_bytes()
    assert payload.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(payload) > 1_000


def test_login_renders_supplied_image_instead_of_an_invented_brand_mark():
    login_source = (FRONTEND / "js" / "login-view.js").read_text(encoding="utf-8")
    assert '<img src="/assets/correlact-logo.png"' in login_source
    assert "login-brand-mark" not in login_source
    assert "Correl<span" not in login_source


def test_login_hides_first_paint_until_visual_layers_are_ready():
    login_source = (FRONTEND / "js" / "login-view.js").read_text(encoding="utf-8")
    assert "correlact-login-booting" in login_source
    assert "stylesheetReady" in login_source
    assert "revealStableLogin" in login_source
    assert 'link.href = "/correlact-fixes.css"' in login_source


def test_polish_layer_prevents_recorded_flicker_and_overlap():
    css = (FRONTEND / "correlact-fixes.css").read_text(encoding="utf-8")
    assert "url('/assets/correlact-logo.png')" in css
    assert ".login-brand img" in css
    assert ".topbar .logo svg { display: none !important; }" in css
    assert ".topbar .brand { display: none !important; }" in css
    assert "input:-webkit-autofill" in css
    assert "-webkit-text-fill-color: #f5f7fb" in css
    assert "0 0 0 1000px #091727 inset" in css
    assert "#login-error.hidden" in css
    assert "@media (min-width: 981px) and (max-height: 1000px)" in css
    assert "@media (min-width: 981px) and (max-height: 760px)" in css
    assert "height: 100dvh" in css
