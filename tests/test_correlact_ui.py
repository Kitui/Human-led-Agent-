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
    assert 'actionsNav.textContent = "Actions"' in main_source

    # These design-system layers are loaded as static <head> links (not
    # injected by main.js at runtime) so the browser requests them
    # immediately; login-view.js's revealStableLogin() finds them by these
    # same data attributes and waits for each to load before showing the
    # login screen.
    assert 'href="/correlact-ui.css" data-correlact-ui="true"' in index_source
    assert 'href="/correlact-layout.css" data-correlact-layout="true"' in index_source
    assert 'href="/correlact-theme.css" data-correlact-theme="true"' in index_source

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


def test_runs_page_more_statuses_dropdown_registers_close_listener_once():
    """renderStatusChips() re-runs on every visit to the Runs page. It used to
    end with document.addEventListener("click", ..., { once: true }) closing
    over that render's #runs-more-wrap node -- each revisit added a brand new
    permanent-until-fired listener referencing an increasingly stale node.
    Fixed by registering a single module-level listener that looks up the
    live #runs-more-wrap at click time instead."""
    source = (FRONTEND / "js" / "runs.js").read_text(encoding="utf-8")

    assert source.count('document.addEventListener("click"') == 1
    assert "{ once: true }" not in source
    assert 'const moreWrap = qs("#runs-more-wrap");' in source


def test_approve_button_reverts_optimistic_stepper_state_on_failure():
    """doApprove() renders the stepper as "approved" before the API call
    returns (optimistic UI). doInvestigate()'s equivalent catch block already
    reverts the stepper on failure (renderStepper("new")); doApprove()'s did
    not, so a failed approval (network error, expired session, backend
    rejection) left the UI falsely showing APPROVED."""
    source = (FRONTEND / "js" / "investigate.js").read_text(encoding="utf-8")
    assert "qsa" not in source  # dead import removed; nothing in this file calls it

    approve_fn = source.split("async function doApprove(runId) {", 1)[1].split("\nasync function doReject", 1)[0]
    assert 'renderStepper("awaiting_approval")' in approve_fn
    assert "showBanner(`Approval failed" in approve_fn


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


def test_topbar_has_no_dead_help_or_notifications_buttons():
    """Neither had any click handler or real destination -- Notifications had
    no backend event system to wire to, and Help's only real destination
    (the Swagger API reference) is a developer surface, not end-user help.
    Removed rather than left as fake affordances."""
    index_source = (FRONTEND / "index.html").read_text(encoding="utf-8")
    assert 'title="Help"' not in index_source
    assert 'title="Notifications"' not in index_source


def test_avatar_menu_exposes_a_real_logout_button():
    """The avatar used to log the user out on a single click with no
    confirmation UI, just a title tooltip. It now opens a small menu (like
    the organization switcher) showing the signed-in username and an
    explicit Log out button."""
    index_source = (FRONTEND / "index.html").read_text(encoding="utf-8")
    main_source = (FRONTEND / "js" / "main.js").read_text(encoding="utf-8")

    assert 'id="avatar-menu"' in index_source
    assert 'id="avatar-menu-username"' in index_source
    assert 'id="logout-btn"' in index_source
    assert "Log out" in index_source
    assert 'qs("#avatar-menu-username").textContent = username;' in main_source
    assert 'qs("#logout-btn").addEventListener("click", logout);' in main_source


def test_topbar_dropdowns_are_keyboard_operable():
    """The organization switcher and avatar/logout control were plain click
    targets with no role, tabindex, or keydown handling -- not operable from
    the keyboard."""
    index_source = (FRONTEND / "index.html").read_text(encoding="utf-8")
    main_source = (FRONTEND / "js" / "main.js").read_text(encoding="utf-8")

    assert 'id="tenant-select" role="button" tabindex="0" aria-haspopup="true" aria-expanded="false"' in index_source
    assert 'id="avatar-wrap" role="button" tabindex="0"' in index_source
    assert 'wrap.setAttribute("aria-expanded", String(open));' in main_source
    assert 'e.key === "Enter" || e.key === " "' in main_source
    assert 'e.key === "Escape"' in main_source


def test_remaining_run_detail_views_use_organization_not_tenant_label():
    """settings.js, dashboard.js, and the Actions page filter already said
    "Organization"; runs.js's table header/detail panel, traces.js's detail
    panel, and action-points.js's kanban card/detail panel still rendered a
    visible "Tenant" label for the identical field."""
    index_source = (FRONTEND / "index.html").read_text(encoding="utf-8")
    runs_source = (FRONTEND / "js" / "runs.js").read_text(encoding="utf-8")
    traces_source = (FRONTEND / "js" / "traces.js").read_text(encoding="utf-8")
    action_points_source = (FRONTEND / "js" / "action-points.js").read_text(encoding="utf-8")

    assert "<h2>Organization Management</h2>" in index_source
    assert "<th>Run ID</th><th>Organization</th>" in runs_source
    assert '<span class="d-label">Organization</span>' in runs_source
    assert '<span class="d-label">Organization</span>' in traces_source
    assert "Organization: ${escapeHtml(run.tenant_id)}" in action_points_source
    assert '<span class="label">Organization</span><span class="value">${escapeHtml(run.tenant_id)}' in action_points_source


def test_organization_dropdowns_escape_tenant_ids_consistently():
    """tasks.js and action-points.js already escaped organization ids before
    interpolating them into innerHTML; main.js's topbar switcher and the
    billing/crm/support/investigation workspace bootstrap dropdowns did not,
    breaking the app-wide escaping convention even though real organization
    ids aren't attacker-controlled today."""
    main_source = (FRONTEND / "js" / "main.js").read_text(encoding="utf-8")
    assert 'data-tenant="${escapeHtml(t)}">${escapeHtml(t)}' in main_source

    for name in ("billing.js", "crm.js", "support.js", "investigation.js"):
        source = (FRONTEND / "js" / name).read_text(encoding="utf-8")
        assert 'value="${escapeHtml(tenantId)}">${escapeHtml(tenantId)}' in source


def test_frontend_module_header_comments_use_correlact_branding():
    """These five files' file-header comments still said "Human-Led Agent
    Lab" -- the old product name -- even after the rest of the rebrand."""
    for name in ("shared.js", "action-points.js", "approvals.js", "runs.js", "traces.js"):
        source = (FRONTEND / "js" / name).read_text(encoding="utf-8")
        assert "Human-Led Agent Lab" not in source
        assert "CorrelAct" in source.splitlines()[0]


def test_public_facing_pages_use_organization_not_tenant_terminology():
    """landing.html is the public marketing page and index.html's Runs
    subtitle is not JS-patched at runtime (unlike the Settings "Coming soon"
    badges) -- both previously said "tenant" where the product-facing term
    is "Organization" everywhere else."""
    landing_source = (FRONTEND / "landing.html").read_text(encoding="utf-8")
    index_source = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert "with organization scope and idempotency enforced" in landing_source
    assert "tenant scope" not in landing_source
    assert "workflow executions across organizations" in index_source
    assert "across tenants" not in index_source


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
