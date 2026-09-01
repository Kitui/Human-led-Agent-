from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_main_app_applies_correlact_branding_and_shared_ui_layer():
    main_source = (FRONTEND / "js" / "main.js").read_text(encoding="utf-8")
    index_source = (FRONTEND / "index.html").read_text(encoding="utf-8")
    theme_source = (FRONTEND / "correlact-theme.css").read_text(encoding="utf-8")
    login_source = (FRONTEND / "js" / "login-view.js").read_text(encoding="utf-8")

    assert 'document.title = "CorrelAct"' in main_source
    # The topbar renders the actual supplied logo asset directly instead of
    # constructing an invented inline brand mark, so the old text/SVG brand
    # is fully hidden rather than replaced with different invented markup.
    assert 'brand.textContent = ""' in main_source
    assert 'brand.setAttribute("aria-hidden", "true")' in main_source
    assert 'logo.innerHTML = \'<img src="/assets/correlact-logo.png?v=20260901d"' in main_source
    assert 'link.href = "/correlact-ui.css"' in main_source
    assert 'link.href = "/correlact-theme.css"' in main_source
    assert 'actionsNav.textContent = "Actions"' in main_source

    # The secured product now uses the intentional navy/red CorrelAct palette.
    assert "--ca-bg: #06111f" in theme_source
    assert "--ca-primary: #ef2b32" in theme_source

    # The outer screen remains part of the SPA shell while login-view.js
    # replaces only its presentation. Keep the exact ids consumed by auth.js.
    assert 'id="login-screen"' in index_source
    for selector_id in (
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


def test_main_app_shell_source_has_no_stale_branding_or_legacy_terminology():
    """The old brand name, its legacy internal tenant codename, and the
    internal "Tenant" term were previously left in the static SPA-shell
    source even though runtime JS immediately overwrote all of them (title,
    brand span, org table header/button/modal, tenant-select placeholder).
    Fix the source directly instead of relying on JS to patch it every load:
    it's what a crawler, "View Source", or a screen reader sees before JS
    runs, and it's what a public-release code audit sees regardless."""
    index_source = (FRONTEND / "index.html").read_text(encoding="utf-8")
    action_points_source = (FRONTEND / "js" / "action-points.js").read_text(encoding="utf-8")

    assert "Human-Led Agent Lab" not in index_source
    assert "tenant_red" not in index_source
    assert "<title>CorrelAct</title>" in index_source
    assert "Add Organization" in index_source
    assert "<th>Organization</th>" in index_source
    assert '<span class="filter-label">Organization</span>' in index_source
    assert "All Organizations" in action_points_source


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
