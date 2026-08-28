import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent_lab.db import async_session_maker, init_db
from agent_lab.evals_runner import run_eval_suite


load_dotenv()


async def run_evals_async():
    await init_db()
    async with async_session_maker() as db:
        suite = await run_eval_suite(db)

    for case in suite.cases:
        status = "PASS" if case.passed else "FAIL"
        print(f"\n[{status}] {case.name}")
        print(f"Priority: {case.actual_priority} (expected {case.expected_priority})")
        print(f"Approval: {case.actual_approval} (expected {case.expected_approval})")

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
