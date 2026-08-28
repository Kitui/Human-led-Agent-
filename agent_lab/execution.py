import asyncio

from agents import Runner

from .agent import execution_agent


async def execute_with_retry(
    execution_input: str,
    max_retries: int = 3,
):
    for attempt in range(1, max_retries + 1):
        try:
            print(
                f"[TRACE] Execution attempt "
                f"{attempt}/{max_retries}"
            )

            result = await Runner.run(
                execution_agent,
                execution_input,
            )

            print(
                f"[TRACE] Execution succeeded "
                f"on attempt {attempt}"
            )

            return result

        except Exception as exc:
            print(
                f"[TRACE] Attempt {attempt} failed: "
                f"{exc}"
            )

            if attempt == max_retries:
                raise

            await asyncio.sleep(1)