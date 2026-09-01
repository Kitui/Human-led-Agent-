from pathlib import Path
import shutil
import subprocess


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
    assert "create_task remains absent from this page" in source


def test_proposal_tool_publishes_real_submission_event():
    source = (JS / "webmcp" / "action-point-tools.js").read_text(encoding="utf-8")

    assert 'ACTION_POINT_SUBMITTED_EVENT = "correlact:action-point-submitted"' in source
    assert "notifyActionPointSubmitted(run, payload)" in source
    assert "new CustomEvent(ACTION_POINT_SUBMITTED_EVENT" in source


def test_create_task_registration_has_abortable_authority_lifecycle():
    source = (JS / "webmcp" / "task-tools.js").read_text(encoding="utf-8")

    assert "let registrationController = null" in source
    assert "new AbortController()" in source
    assert "{ signal: controller.signal }" in source
    assert "export function unregisterTaskWebMcpTool()" in source
    assert "registrationController.abort()" in source
    assert "isTaskWebMcpToolRegistered()" in source


def test_tasks_only_expose_create_task_when_executable_approved_work_exists():
    html = (FRONTEND / "tasks" / "index.html").read_text(encoding="utf-8")
    source = (JS / "tasks.js").read_text(encoding="utf-8")

    assert "Human approval controls tool exposure" in html
    assert "Registered only while approved work exists" in html
    assert "create_task is not exposed until approval is verified" in html
    assert "runs.filter((run) => !!approvedCustomer(run))" in source
    assert "if (!executableRuns.length)" in source
    assert "unregisterTaskWebMcpTool()" in source
    assert "await registerTaskWebMcpTool()" in source
    assert source.index("if (!executableRuns.length)") < source.index("await registerTaskWebMcpTool()")
    assert "create_task is removed from this page's WebMCP context" in source


def test_dynamic_authority_javascript_parses():
    node = shutil.which("node")
    if node is None:
        return

    for path in (
        JS / "investigation.js",
        JS / "tasks.js",
        JS / "webmcp" / "action-point-tools.js",
        JS / "webmcp" / "task-tools.js",
    ):
        subprocess.run(
            [node, "--check", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
