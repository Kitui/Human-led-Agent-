import asyncio

from dotenv import load_dotenv

from .db import async_session_maker, init_db
from .models import RunStatus
from .workflow import (
    GuardrailBlockedError,
    InvalidTenantError,
    approve_run,
    investigate_issue,
    reject_run,
)


load_dotenv()


async def main():
    """CLI adapter kept for learning/testing. The core logic lives in workflow.py."""

    await init_db()

    tenant_id = input("Tenant ID: ").strip()
    issue = input("Describe the operational issue: ").strip()

    async with async_session_maker() as db:
        await _run_cli(db, tenant_id, issue)


async def _run_cli(db, tenant_id: str, issue: str) -> None:
    try:
        run = await investigate_issue(tenant_id, issue, db=db)
    except InvalidTenantError as exc:
        print(f"[STOPPED] {exc}")
        return
    except GuardrailBlockedError as exc:
        print("\n[GUARDRAIL BLOCKED]")
        print(f"Reason: {exc}")
        return

    action_point = run.action_point

    if action_point is None:
        print("[STOPPED] No Action Point returned.")
        return

    print("\n--- PROPOSED ACTION POINT ---")
    print(f"Run ID: {run.run_id}")
    print(f"Title: {action_point.title}")
    print(f"Issue Type: {action_point.issue_type}")
    print(f"Summary: {action_point.summary}")
    print(f"Priority: {action_point.priority}")
    print(f"Recommended Action: {action_point.recommended_action}")
    print(f"Target Team: {action_point.target_team}")
    print(f"Confidence: {action_point.confidence}")
    print(
        "Requires Human Approval: "
        f"{action_point.requires_human_approval}"
    )

    if run.status == RunStatus.COMPLETED:
        print("\nNo execution approval required.")
        return

    print("\n--- HUMAN APPROVAL REQUIRED ---")

    while True:
        decision = input("Approve this action? (yes/no): ").strip().lower()

        if decision == "yes":
            run = await approve_run(db, run.run_id)
            break

        if decision == "no":
            run = await reject_run(db, run.run_id)
            print("[REJECTED]")
            print("No action was executed.")
            return

        print("Please enter 'yes' or 'no'.")

    print("\n--- FINAL RESULT ---")
    print(run.execution_result)
    print(f"[STATE] {run.status}")


if __name__ == "__main__":
    asyncio.run(main())
