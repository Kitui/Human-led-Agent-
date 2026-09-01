from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "js"


def test_dashboard_uses_real_eval_state_and_organization_language():
    source = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")

    assert "Latest Evaluation" in source
    assert "Operational Readiness" in source
    assert "api(\"/evals/runs\")" in source
    assert "<th>Organization</th>" in source
    assert "<th>Quality Gate</th>" not in source
    assert "Not monitored" not in source


def test_settings_replace_mockup_placeholders_with_real_capability_state():
    source = (FRONTEND / "settings.js").read_text(encoding="utf-8")

    assert "Organization Management" in source
    assert "+ Add Organization" in source
    assert "Connected Capabilities" in source
    assert "Security Controls" in source
    assert "Consequential write actions" in source
    assert "Evaluation history" in source
    assert "Azure Key Vault references" in source
    assert "Coming soon" not in source
    assert "Not configured yet" not in source
    assert "Not monitored" not in source


def test_quality_gate_is_strict_98_percent():
    source = (ROOT / "agent_lab" / "eval_cases.py").read_text(encoding="utf-8")
    assert "MINIMUM_SCORE = 98.0" in source


def test_product_completion_javascript_parses():
    node = shutil.which("node")
    if node is None:
        return

    for filename in ("dashboard.js", "settings.js"):
        subprocess.run(
            [node, "--check", str(FRONTEND / filename)],
            check=True,
            capture_output=True,
            text=True,
        )
