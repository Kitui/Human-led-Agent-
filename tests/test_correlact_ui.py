from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_main_app_applies_correlact_branding_and_shared_ui_layer():
    main_source = (FRONTEND / "js" / "main.js").read_text(encoding="utf-8")
    theme_source = (FRONTEND / "correlact-theme.css").read_text(encoding="utf-8")
    login_source = (FRONTEND / "js" / "login-view.js").read_text(encoding="utf-8")

    assert 'document.title = "CorrelAct"' in main_source
    assert "brand.innerHTML" in main_source
    assert "Correl" in main_source and "Act" in main_source
    assert 'link.href = "/correlact-ui.css"' in main_source
    assert 'link.href = "/correlact-theme.css"' in main_source
    assert 'actionsNav.textContent = "Actions"' in main_source

    # The secured product now uses the intentional navy/red CorrelAct palette.
    assert "--ca-bg: #06111f" in theme_source
    assert "--ca-primary: #ef2b32" in theme_source

    # The login redesign is presentation-only: keep the exact form/field ids
    # consumed by auth.js so authentication/session semantics do not change.
    for selector_id in (
        "login-screen",
        "login-form",
        "login-username",
        "login-password",
        "login-error",
        "login-submit-btn",
    ):
        assert f'id=\"{selector_id}\"' in login_source


def test_investigation_workflow_labels_are_human_readable():
    source = (FRONTEND / "js" / "investigate.js").read_text(encoding="utf-8")
    assert 'label: "AWAITING APPROVAL"' in source
    assert '"Proposed Action · Awaiting Approval"' in source
    assert 'label: "AWAITING_APPROVAL"' not in source


def test_shared_ui_layer_fixes_responsive_stepper_and_timeline_geometry():
    css = (FRONTEND / "correlact-ui.css").read_text(encoding="utf-8")
    assert ".exec-step:not(:last-child)::before" in css
    assert "top: 39px;" in css
    assert "@media (max-width: 760px)" in css
    assert ".stepper {\n    flex-direction: column;" in css
    assert ".sidebar,\n  .sidebar.collapsed {\n    position: fixed;" in css


def test_webmcp_workspaces_use_exact_correlact_brand_casing():
    pages = [
        FRONTEND / "support" / "index.html",
        FRONTEND / "crm" / "index.html",
        FRONTEND / "billing" / "index.html",
        FRONTEND / "investigation" / "index.html",
        FRONTEND / "tasks" / "index.html",
    ]
    for page in pages:
        source = page.read_text(encoding="utf-8")
        assert "CorrelAct" in source
        assert "/correlact-ui.css" in source
        assert "Human-Led Agent Lab" not in source
