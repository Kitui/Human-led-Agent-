import asyncio
import logging

from agents import Agent, Runner

logger = logging.getLogger(__name__)


async def execute_with_retry(
    execution_agent: Agent,
    execution_input: str,
    max_retries: int = 3,
):
    for attempt in range(1, max_retries + 1):
        try:
            logger.debug(f"[TRACE] Execution attempt {attempt}/{max_retries}")

            result = await Runner.run(
                execution_agent,
                execution_input,
            )

            logger.debug(f"[TRACE] Execution succeeded on attempt {attempt}")

            return result

        except Exception as exc:
            logger.warning(f"[TRACE] Attempt {attempt} failed: {exc}")

            if attempt == max_retries:
                raise

            await asyncio.sleep(1)
