import time

from agents import Runner

from agent import execution_agent


def execute_with_retry(execution_input: str, max_retries: int = 3):
    for attempt in range(1, max_retries + 1):
        try:
            print(f"[EXECUTION ATTEMPT {attempt}]")

            return Runner.run_sync(
                execution_agent,
                execution_input,
            )

        except Exception as exc:
            print(f"[ERROR] {exc}")

            if attempt == max_retries:
                raise

            time.sleep(1)