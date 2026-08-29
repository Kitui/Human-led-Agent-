import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent_lab.db import (
    async_session_maker,
    init_db,
    seed_default_tenant_settings,
    seed_default_tenants,
)
from agent_lab.evals_runner import run_eval_suite


load_dotenv()


async def run_evals_async():
    await init_db()
    # The standalone CI/CLI eval runner does not enter FastAPI's lifespan,
    # so provision the same default tenant context explicitly.
    await seed_default_tenants()
    await seed_default_tenant_settings()

    async with async_session_maker() as db:
        suite = await run_eval_suite(db)

    for case in suite.cases:
        status = "PASS" if case.passed else "FAIL"
        print(f"\n[{status}] {case.name} [{case.category}]")
        print(f"Outcome: {case.actual_outcome} (expected {case.expected_outcome})")

        if case.expected_priority is not None:
            print(f"Priority: {case.actual_priority} (expected {case.expected_priority})")
        if case.expected_approval is not None:
            print(f"Approval: {case.actual_approval} (expected {case.expected_approval})")
        if case.expects_tool_call:
            print(
                "Customer tool: "
                f"{case.actual_tool_result} (expected {case.expected_tool_result or 'FOUND'})"
            )
        if case.error:
            print(f"Error: {case.error}")

    print("\n--- EVALUATION RESULT ---")
    print(f"{suite.passed_count}/{suite.total_count} passed")
    print(f"Score: {suite.score:.1f}%")

    if suite.score < suite.threshold:
        print(
            f"\n[QUALITY GATE FAILED] "
            f"Minimum required score is {suite.threshold}%."
        )
        raise SystemExit(1)

    print("\n[QUALITY GATE PASSED]")


if __name__ == "__main__":
    asyncio.run(run_evals_async())
