from agent_lab.models import ActionPoint, ApprovedExecution
from agent_lab.webmcp_tasks import approved_execution_type
from agent_lab.models import WorkflowRun


def test_valid_action_point_remains_backward_compatible_without_execution_metadata():
    action = ActionPoint(
        title="Test issue",
        issue_type="billing",
        summary="Test summary",
        priority="high",
        recommended_action="Investigate",
        confidence=0.9,
        requires_human_approval=True,
        target_team="Billing",
    )

    assert action.priority == "high"
    assert action.confidence == 0.9
    assert action.execution is None

    # Persisted pre-feature Action Points still resolve to the original task
    # capability when loaded into a run.
    run = WorkflowRun(
        run_id="legacy-run",
        tenant_id="NorthStar",
        issue="Legacy issue",
        action_point=action,
    )
    assert approved_execution_type(run) == "create_task"


def test_action_point_can_bind_an_exact_crm_execution_scope():
    action = ActionPoint(
        title="Escalate renewal",
        issue_type="renewal",
        summary="Renewal is blocked.",
        priority="high",
        recommended_action="Open a CRM escalation.",
        confidence=0.99,
        requires_human_approval=True,
        target_team="Account Management",
        execution=ApprovedExecution(
            type="update_crm_status",
            crm_expected_status="blocked",
            crm_target_status="escalation_open",
        ),
    )

    assert action.execution is not None
    assert action.execution.type == "update_crm_status"
    assert action.execution.crm_expected_status == "blocked"
    assert action.execution.crm_target_status == "escalation_open"
