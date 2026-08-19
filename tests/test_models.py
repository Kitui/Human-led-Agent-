from models import ActionPoint


def test_valid_action_point():
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