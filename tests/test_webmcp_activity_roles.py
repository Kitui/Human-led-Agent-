from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
JS = FRONTEND / "js"


def test_traces_page_classifies_real_events_into_activity_roles():
    source = (JS / "traces.js").read_text(encoding="utf-8")

    assert "function activityRole({ kind, tag, rawLabel })" in source
    assert '"AGENT READ"' in source
    assert '"AGENT PROPOSAL"' in source
    assert '"HUMAN DECISION"' in source
    assert '"AGENT WRITE"' in source
    assert '"OUTCOME"' in source
    # Classification must key off real fields agent_lab already records
    # (see TraceEvent.tag values in agent_lab/api.py and webmcp_tasks.py),
    # never a fabricated category.
    assert 'tag === "EVIDENCE"' in source
    assert 'tag === "HUMAN_REVIEW"' in source
    assert 'tag === "HUMAN_APPROVAL"' in source
    assert 'tag === "WEBMCP_WRITE"' in source
    assert 'tag === "EXECUTION_RESULT"' in source
    assert "return null;" in source


def test_activity_role_badges_render_in_timeline_and_details_table():
    source = (JS / "traces.js").read_text(encoding="utf-8")

    assert "function roleBadgeHtml(role)" in source
    assert "roleBadgeHtml(role)" in source
    assert "roleBadgeHtml(activityRole({ kind: e.kind, tag: e.tag, rawLabel: e.label }))" in source
    assert "<th>Role</th>" in source


def test_activity_role_badge_styles_cover_every_role():
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    for role_class in (
        "role-read", "role-propose", "role-human", "role-write", "role-outcome", "role-safety",
    ):
        assert f".role-badge.{role_class}" in css


def test_evidence_citation_events_appear_as_their_own_timeline_step():
    source = (JS / "traces.js").read_text(encoding="utf-8")

    # Evidence-attached events share `kind: "mcp"` with real tool call/result
    # pairs but never match the "X called" / "X result received" shape, so
    # buildExecutionSteps must give them their own step instead of silently
    # dropping them (they used to vanish from the Execution Timeline while
    # still appearing in the raw Trace Details table).
    assert 'if (/result received$/.test(e.label)) continue;' in source
    assert "A standalone mcp-kind event" in source


def test_traces_javascript_parses():
    node = shutil.which("node")
    if node is None:
        return
    subprocess.run(
        [node, "--check", str(JS / "traces.js")],
        check=True,
        capture_output=True,
        text=True,
    )
