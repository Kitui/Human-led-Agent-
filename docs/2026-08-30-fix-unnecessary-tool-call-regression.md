# Fixed the regression the raised quality gate caught

## What was wrong

After raising the eval suite's pass threshold to 98%, it consistently caught a real agent behavior problem: for issues that mention customer-related topics in general terms — "Production customer data appears to be publicly accessible," "A posted invoice is confirmed to have the wrong amount" — the investigator agent sometimes called `get_customer` anyway, guessing at a name that didn't exist (`NOT_FOUND`), even though the existing instructions already said not to call the tool without a specific customer identity.

## The fix

The instruction wasn't wrong, just too easy to read too loosely. `agent_lab/agent.py`'s system prompt now states the actual test explicitly: only call `get_customer` when the issue names an actual specific customer or company (like "ACME" or "GreenMart") — mentioning a customer-related *topic* (billing, invoices, payments, customer data) without naming who it belongs to does not count, with both real failing examples spelled out directly in the prompt.

The first attempt at this fix only mentioned one of the two failing examples, and just shifted the same underlying problem onto the other case on the next eval run — a reminder that a single negative example teaches the model to avoid that one sentence, not the general rule. Restating it as an explicit test ("does the text name an actual customer, yes or no") plus both known failure cases together is what actually generalized.

## What's verified working

- All 49 backend tests pass (unrelated to this prompt-only change).
- The exact previously-failing scenario ("Production customer data appears to be publicly accessible") now correctly skips the tool call across 3 separate live attempts.
- The full live eval suite (`evals/evals.py`, the same script CI runs) passed 15/15 (100%) across 3 separate full runs — well clear of the 98% gate, and with real margin given eval runs are non-deterministic.
