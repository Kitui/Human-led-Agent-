from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_correlact_logo_is_a_real_240_by_135_png_asset():
    logo = FRONTEND / "assets" / "correlact-logo.png"
    payload = logo.read_bytes()
    assert payload.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(payload) > 1_000
    width, height = struct.unpack(">II", payload[16:24])
    assert (width, height) == (240, 135)


def test_login_renders_image_instead_of_an_invented_brand_mark():
    login_source = (FRONTEND / "js" / "login-view.js").read_text(encoding="utf-8")
    assert '<img src="/assets/correlact-logo.png?v=20260901d"' in login_source
    assert 'width="240" height="135"' in login_source
    assert "login-brand-mark" not in login_source
    assert "Correl<span" not in login_source


def test_login_hides_first_paint_until_visual_layers_and_logo_are_ready():
    login_source = (FRONTEND / "js" / "login-view.js").read_text(encoding="utf-8")
    assert "correlact-login-booting" in login_source
    assert "stylesheetReady" in login_source
    assert "imageReady" in login_source
    assert "revealStableLogin" in login_source
    assert 'link.href = "/correlact-fixes.css?v=20260901d"' in login_source


def test_polish_layer_prevents_recorded_flicker_overlap_and_icon_collision():
    css = (FRONTEND / "correlact-fixes.css").read_text(encoding="utf-8")
    assert "url('/assets/correlact-logo.png?v=20260901d')" in css
    assert ".login-brand img" in css
    assert "height: auto !important" in css
    assert "aspect-ratio: auto !important" in css
    assert "clip-path: none !important" in css
    assert ".topbar .logo svg { display: none !important; }" in css
    assert ".topbar .brand { display: none !important; }" in css
    assert 'input[type="text"]' in css
    assert 'input[type="password"]' in css
    assert "padding: 0 52px 0 52px !important" in css
    assert "margin: 0 !important" in css
    assert "input:-webkit-autofill" in css
    assert "-webkit-text-fill-color: #f5f7fb" in css
    assert "0 0 0 1000px #091727 inset" in css
    assert "#login-error.hidden" in css
    assert "@media (min-width: 981px) and (max-height: 1000px)" in css
    assert "@media (min-width: 981px) and (max-height: 760px)" in css
    assert "height: 100dvh" in css
