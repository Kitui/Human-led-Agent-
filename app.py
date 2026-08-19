from dotenv import load_dotenv
from agents import Runner

from agent import investigator_agent, execution_agent
from models import AgentRun, RunStatus
from execution import execute_with_retry
import hashlib
from guardrails import validate_input
from tools import SECURITY_STATE

load_dotenv()


def main():
    tenant_id = input(
        "Tenant ID: "
    ).strip()

    VALID_TENANTS = {
    "tenant_red",
    "tenant_green",
    }
    
    if tenant_id not in VALID_TENANTS:
        print("[STOPPED] Invalid tenant.")
        return

    user_input = input(
        "Describe the operational issue: "
    )

    guardrail_result = validate_input(user_input)
    if guardrail_result.blocked:
        print("\n[GUARDRAIL BLOCKED]")
        print(f"Reason: {guardrail_result.reason}")
        return

    # Create run state
    run = AgentRun()

    print(f"[STATE] {run.status}")

    # -----------------------------
    # PHASE 1: INVESTIGATION
    # -----------------------------

    run.status = RunStatus.INVESTIGATING
    run.step_count += 1

    print(f"[STATE] {run.status}")

    investigation_input = f"""
    Current Tenant:
    {tenant_id}
    Operational Issue:
    {user_input}
    When calling get_customer,
    you MUST pass the current tenant_id.
    """

    result = Runner.run_sync(
        investigator_agent,
        investigation_input,
    )

    if SECURITY_STATE["access_denied"]:
        run.status = RunStatus.FAILED

        print(f"[STATE] {run.status}")
        print(
            "\n[STOPPED] Cross-tenant access denied. "
            "The workflow cannot continue."

        )

        return

    action_point = result.final_output

    # -----------------------------
    # SHOW PROPOSED ACTION POINT
    # -----------------------------

    print("\n--- PROPOSED ACTION POINT ---")

    print(f"Title: {action_point.title}")
    print(f"Issue Type: {action_point.issue_type}")
    print(f"Summary: {action_point.summary}")
    print(f"Priority: {action_point.priority}")

    print(
        f"Recommended Action: "
        f"{action_point.recommended_action}"
    )

    print(f"Target Team: {action_point.target_team}")
    print(f"Confidence: {action_point.confidence}")

    print(
        "Requires Human Approval: "
        f"{action_point.requires_human_approval}"
    )

    # -----------------------------
    # CHECK IF APPROVAL IS NEEDED
    # -----------------------------

    if not action_point.requires_human_approval:
        run.status = RunStatus.COMPLETED

        print(f"[STATE] {run.status}")
        print("\nNo execution approval required.")
        return

    # -----------------------------
    # HUMAN APPROVAL
    # -----------------------------

    run.status = RunStatus.AWAITING_APPROVAL
    run.step_count += 1

    print(f"[STATE] {run.status}")

    print("\n--- HUMAN APPROVAL REQUIRED ---")

    while True:
        decision = input(
            "Approve this action? (yes/no): "
        ).strip().lower()

        if decision == "yes":
            print("[APPROVED]")
            break

        if decision == "no":
            run.status = RunStatus.REJECTED

            print("[REJECTED]")
            print(f"[STATE] {run.status}")
            print("No action was executed.")

            return

        print("Please enter 'yes' or 'no'.")

    # -----------------------------
    # APPROVED
    # -----------------------------

    run.status = RunStatus.APPROVED

    print(f"[STATE] {run.status}")

    # -----------------------------
    # STOP CONDITION
    # -----------------------------

    if run.step_count >= run.max_steps:
        run.status = RunStatus.FAILED

        print(f"[STATE] {run.status}")
        print("[STOPPED] Maximum workflow steps reached.")

        return

      

    # -----------------------------
    # PHASE 2: EXECUTION
    # -----------------------------

    run.status = RunStatus.EXECUTING
    run.step_count += 1

    print(f"[STATE] {run.status}")

    # -----------------------------
    # IDEMPOTENCY KEY GENERATION
    # -----------------------------
    
    action_string = (
        f"{action_point.title}|"
        f"{action_point.priority}|"
        f"{action_point.recommended_action}|"
        f"{action_point.target_team}"
    )
    
    idempotency_key = hashlib.sha256(
        action_string.encode()
    ).hexdigest()

    print(
    f"[IDEMPOTENCY KEY] "
    f"{idempotency_key[:12]}..."
)

    execution_input = f"""
The following Action Point has been approved by a human.

Customer issue:
{user_input}

Approved Action Point:

Title:
{action_point.title}

Priority:
{action_point.priority}

Recommended Action:
{action_point.recommended_action}

Target Team:
{action_point.target_team}

Idempotency Key:
{idempotency_key}

Execute exactly this approved action using create_task.

You MUST pass the provided idempotency key to create_task.

Do not create additional actions.
Do not change the scope of the approved action.
"""

    try:
        execution_result = execute_with_retry(
            execution_input,
            max_retries=3,
        )

    except Exception as exc:
        run.status = RunStatus.FAILED

        print(f"[STATE] {run.status}")

        print("\n--- EXECUTION FAILED ---")
        print(str(exc))

        return

    # -----------------------------
    # COMPLETED
    # -----------------------------

    run.status = RunStatus.COMPLETED

    print(f"[STATE] {run.status}")

    print("\n--- FINAL RESULT ---")

    print(execution_result.final_output)


if __name__ == "__main__":
    main()