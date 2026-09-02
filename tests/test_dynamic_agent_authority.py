from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
JS = FRONTEND / "js"


def test_investigation_visibly_locks_execution_authority():
    html = (FRONTEND / "investigation" / "index.html").read_text(encoding="utf-8")
    source = (JS / "investigation.js").read_text(encoding="utf-8")

    assert "Dynamic agent authority" in html
    assert "What the browser agent can do now" in html
    assert 'id="authority-execute-state">LOCKED<' in html
    assert "create_task" in html
    assert "deliberately absent here" in html
    assert "ACTION_POINT_SUBMITTED_EVENT" in source
    assert "Awaiting human approval" in source
    assert "No controlled write tool is exposed in this workspace" in source
    assert "proposal-specific execution authority" in source


def test_proposal_tool_publishes_real_submission_event():
    source = (JS / "webmcp" / "action-point-tools.js").read_text(encoding="utf-8")

    assert 'ACTION_POINT_SUBMITTED_EVENT = "correlact:action-point-submitted"' in source
    assert "notifyActionPointSubmitted(run, payload)" in source
    assert "new CustomEvent(ACTION_POINT_SUBMITTED_EVENT" in source


def test_controlled_write_registration_has_abortable_authority_lifecycle():
    source = (JS / "webmcp" / "task-tools.js").read_text(encoding="utf-8")

    assert "let registrationController = null" in source
    assert "new AbortController()" in source
    assert "{ signal: controller.signal }" in source
    assert "export function unregisterTaskWebMcpTool()" in source
    assert "registrationController.abort()" in source
    assert "isTaskWebMcpToolRegistered" in source
    assert 'name: "create_task"' in source
    assert 'name: "update_crm_status"' in source


def test_tasks_only_expose_capabilities_for_executable_approved_work():
    html = (FRONTEND / "tasks" / "index.html").read_text(encoding="utf-8")
    source = (JS / "tasks.js").read_text(encoding="utf-8")

    assert "Human approval controls tool exposure" in html
    assert "Registered only while approved work exists" in html
    assert "create_task is not exposed until approval is verified" in html
    assert "runs.filter((run) => !!approvedCustomer(run))" in source
    assert "if (!executableRuns.length)" in source
    assert "unregisterTaskWebMcpTool()" in source
    assert "await registerTaskWebMcpTool(executionTypes)" in source
    assert source.index("if (!executableRuns.length)") < source.index("await registerTaskWebMcpTool(executionTypes)")
    assert "Write tools are removed from this page's WebMCP context" in source
    assert "const executionTypes = [...new Set(executableRuns.map(executionType))]" in source


def test_execution_visibly_completes_authority_before_queue_refresh():
    css = (FRONTEND / "tasks.css").read_text(encoding="utf-8")
    source = (JS / "tasks.js").read_text(encoding="utf-8")

    assert ".authority-stage.state-complete::before" in css
    assert "function renderExecutionCompleted(result)" in source
    assert '"COMPLETED"' in source
    assert '"state-complete"' in source
    assert "Authority consumed for this run" in source
    assert "renderExecutionCompleted(result);" in source
    assert "renderExecutionCompleted(event.detail);" in source
    assert "window.setTimeout(() => { loadApprovedRuns().catch(console.error); }, 2500);" in source


def test_investigation_renders_evidence_correlation_chain_from_real_proposal_data():
    html = (FRONTEND / "investigation" / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "investigation.css").read_text(encoding="utf-8")
    source = (JS / "investigation.js").read_text(encoding="utf-8")

    assert 'id="correlation-section"' in html
    assert 'id="correlation-chain"' in html
    assert 'id="correlation-confidence"' in html
    assert 'id="correlation-sources"' in html
    assert ".correlation-node.cause-node" in css
    assert ".correlation-node.action-node" in css
    assert "function renderEvidenceCorrelation(detail)" in source
    assert "const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];" in source
    assert "Math.round(payload.confidence * 100)" in source
    assert '$("#correlation-sources").textContent = String(evidence.length);' in source
    assert "renderEvidenceCorrelation(event.detail);" in source
    assert 'payload.execution?.type || "create_task"' in source
    assert "crm_expected_status" in source
    assert "crm_target_status" in source
    # Confidence and evidence-count must come from the agent's real submitted payload,
    # never a hardcoded or invented display value.
    assert "confidence: 0." not in source
    assert "98%" not in source


def test_investigation_escapes_backend_evidence_before_rendering():
    """renderEvidence() renders backend-sourced fields (support case subject,
    the customer's free-text message, account name, ...) into innerHTML. Every
    other evidence renderer in the app (dashboard, approvals, action-points)
    escapes dynamic values first; this one previously didn't, which is a real
    XSS gap for exactly the kind of free-text field a support case carries."""
    source = (JS / "investigation.js").read_text(encoding="utf-8")

    assert "<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatValue(value))}</dd>" in source


def test_dynamic_authority_javascript_parses():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")

    for path in (
        JS / "investigation.js",
        JS / "tasks.js",
        JS / "approvals.js",
        JS / "webmcp" / "action-point-tools.js",
        JS / "webmcp" / "task-tools.js",
    ):
        subprocess.run(
            [node, "--check", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
