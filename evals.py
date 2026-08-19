from agents import Runner

from agent import investigator_agent

from dotenv import load_dotenv

load_dotenv()


EVAL_CASES = [
    {
        "name": "high value blocked renewal",
        "tenant_id": "tenant_red",
        "input": (
            "ACME says their invoice amount is wrong "
            "and their renewal is blocked."
        ),
        "expected_issue_type": "billing",
        "expected_priority": "high",
        "expected_approval": True,
    },

    {
        "name": "minor office issue",
        "tenant_id": "tenant_red",
        "input": "The office printer has run out of paper.",
        "expected_priority": "low",
        "expected_approval": False,
    },

    {
        "name": "critical security issue",
        "tenant_id": "tenant_red",
        "input": (
            "Production customer data appears "
            "to be publicly accessible."
        ),
        "expected_priority": "critical",
        "expected_approval": True,
    },
]

def run_evals():
    passed = 0

    for case in EVAL_CASES:

        investigation_input = f"""
Current Tenant:
{case['tenant_id']}

Operational Issue:
{case['input']}
"""

        result = Runner.run_sync(
            investigator_agent,
            investigation_input,
        )

        output = result.final_output

        priority_ok = (
            output.priority
            == case["expected_priority"]
        )

        approval_ok = (
            output.requires_human_approval
            == case["expected_approval"]
        )

        case_passed = (
            priority_ok
            and approval_ok
        )

        if case_passed:
            passed += 1
            status = "PASS"
        else:
            status = "FAIL"

        print(f"\n[{status}] {case['name']}")
        print(
            f"Priority: "
            f"{output.priority} "
            f"(expected {case['expected_priority']})"
        )

        print(
            f"Approval: "
            f"{output.requires_human_approval} "
            f"(expected {case['expected_approval']})"
        )

    score = passed / len(EVAL_CASES) * 100

    print("\n--- EVALUATION RESULT ---")
    print(f"{passed}/{len(EVAL_CASES)} passed")
    print(f"Score: {score:.1f}%")

    MIN_SCORE = 90.0

    if score < MIN_SCORE:
        print(
            f"\n[QUALITY GATE FAILED] "
            f"Minimum required score is {MIN_SCORE}%."
        )
        raise SystemExit(1)

    print("\n[QUALITY GATE PASSED]")


if __name__ == "__main__":
    run_evals()