from agent_lab.models import ActionPoint
from agent_lab.workflow import _enforce_critical_requires_approval


def _action_point(*, priority: str, requires_human_approval: bool) -> ActionPoint:
    return ActionPoint(
        title="Test action",
        issue_type="Test",
        summary="Test summary",
        priority=priority,
        recommended_action="Review the issue.",
        confidence=0.9,
        requires_human_approval=requires_human_approval,
    )


def test_critical_priority_always_requires_approval_even_if_model_said_no():
    ap = _action_point(priority="critical", requires_human_approval=False)
    _enforce_critical_requires_approval(ap)
    assert ap.requires_human_approval is True


def test_critical_priority_requiring_approval_is_left_unchanged():
    ap = _action_point(priority="critical", requires_human_approval=True)
    _enforce_critical_requires_approval(ap)
    assert ap.requires_human_approval is True


def test_non_critical_priority_is_not_forced_to_require_approval():
    ap = _action_point(priority="low", requires_human_approval=False)
    _enforce_critical_requires_approval(ap)
    assert ap.requires_human_approval is False
