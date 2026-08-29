from agents import Agent

from .models import ActionPoint, TenantSettings
from .tools import create_task


SYSTEM_PROMPT = """
You are an operations investigation agent.

Investigate operational issues and produce clear,
human-directed Action Points.

INVESTIGATION RULES

- If the issue names or clearly identifies a specific customer, you MUST use
  get_customer before producing an Action Point.
- Only call get_customer when the issue text contains an actual specific
  customer or company name (e.g. "ACME", "GreenMart") or account
  identifier. Do NOT call get_customer just because the issue mentions a
  customer-related topic in general terms -- billing, invoices, payments,
  or customer data with no specific name attached do NOT count as
  identifying a customer. For example, neither "Production customer data
  appears to be publicly accessible" nor "A posted invoice is confirmed to
  have the wrong amount" names an actual customer, so get_customer must
  not be called for either.
- Never invent or guess a customer name in order to call get_customer.
- Always pass the current tenant_id to get_customer.
- Never invent customer information.
- Use tool results as evidence.
- If get_customer returns ACCESS_DENIED, do not continue the
  customer-specific investigation.

ACTION RULES

- Recommend the appropriate next action.
- If the recommendation changes external state,
  set requires_human_approval to true.
- Do not execute write actions during investigation.

HUMAN APPROVAL RULES

Set requires_human_approval to true only when the recommended action
would perform a consequential system or business change, such as:

- creating or modifying business records
- sending external messages
- changing billing or financial data
- updating customer/account state
- deleting data
- triggering external workflows

Do not require approval for simple informational recommendations
or low-risk physical/manual actions such as replacing printer paper.
"""


EXECUTION_PROMPT = """
You are an operations execution agent.

The human has already reviewed and approved the proposed Action Point.

Execute the approved action using the available tool.

Rules:
- Execute only the action that was approved.
- Do not change the scope of the action.
- Do not invent additional work.
- Report whether execution succeeded or failed.
"""


def build_execution_agent(model: str | None = None) -> Agent:
    """Per-call construction (replaces the old module-level singleton) so
    each tenant's configured default_model can be applied independently."""

    return Agent(
        name="Operations Executor",
        instructions=EXECUTION_PROMPT,
        tools=[create_task],
        model=model,
    )


def build_investigator_agent(mcp_server, instructions: str, *, model: str | None = None) -> Agent:
    return Agent(
        name="Operations Investigator",
        instructions=instructions,
        output_type=ActionPoint,
        mcp_servers=[mcp_server],
        model=model,
    )


def resolve_system_prompt(settings: TenantSettings) -> str:
    """Decide which base system prompt an investigation uses for this tenant.

    - auto_update_prompt=True (default): always SYSTEM_PROMPT, regardless of
      any saved override -- "stay on defaults, don't use my override".
    - auto_update_prompt=False: use the tenant's saved override if one is
      set (non-empty), else fall back to SYSTEM_PROMPT.

    Pure function, no I/O -- unit-testable without a DB or a real agent call.
    """

    if settings.auto_update_prompt:
        return SYSTEM_PROMPT
    if settings.system_prompt_override:
        return settings.system_prompt_override
    return SYSTEM_PROMPT


def resolve_investigator_instructions(settings: TenantSettings) -> str:
    """Final instructions string for a tenant's investigator agent: the
    resolved base prompt plus an optional language directive. Real
    behavioral effect -- only appended when the tenant has changed
    default_language away from the default."""

    instructions = resolve_system_prompt(settings)
    if settings.default_language and settings.default_language != "English (US)":
        instructions += f"\n\nRespond to the human in {settings.default_language}."
    return instructions