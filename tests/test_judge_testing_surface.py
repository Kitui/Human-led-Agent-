from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_investigation_surface_is_chatgpt_first_and_inspector_optional():
    source = (ROOT / "frontend" / "investigation" / "index.html").read_text(encoding="utf-8")

    assert "challenge demo credentials supplied with the submission" in source
    assert "ChatGPT's in-app browser" in source
    assert "Model Context Tool Inspector is optional" in source
    assert "Investigate the ACME renewal issue for tenant_red" in source
    assert "submit_action_point" in source
    assert "Open Tasks for execution" in source


def test_tasks_surface_is_chatgpt_first_and_preserves_controlled_write_prompt():
    source = (ROOT / "frontend" / "tasks" / "index.html").read_text(encoding="utf-8")

    assert "Stay signed in to CorrelAct" in source
    assert "ChatGPT's" in source and "in-app browser" in source
    assert "Model Context Tool Inspector remains optional" in source
    assert "Execute the already-approved ACME task for run RUN_ID" in source
    assert "Use create_task" in source
    assert "Do not alter the approved action" in source
