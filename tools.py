from agents import function_tool
import random


PROCESSED_ACTIONS = {}

SECURITY_STATE = {
    "access_denied": False
}

CUSTOMERS = {
    "ACME": {
        "name": "ACME",
        "tenant_id": "tenant_red",
        "plan": "Enterprise",
        "account_status": "active",
        "renewal_value": 120000,
        "renewal_status": "blocked",
        "billing_status": "invoice_dispute",
    },

    "GREENMART": {
        "name": "GreenMart",
        "tenant_id": "tenant_green",
        "plan": "Business",
        "account_status": "active",
        "renewal_value": 25000,
        "renewal_status": "normal",
        "billing_status": "clear",
    },
}


@function_tool
def get_customer(
    customer_name: str,
    tenant_id: str,
) -> dict:
    """
    Retrieve customer account information.

    Only return customers belonging to the requesting tenant.
    """

    print(
        f"\n[READ TOOL] "
        f"get_customer({customer_name}, {tenant_id})"
    )

    customer = CUSTOMERS.get(
        customer_name.upper()
    )

    if customer is None:
        return {
            "found": False,
            "message": "Customer was not found.",
        }

    if customer["tenant_id"] != tenant_id:
        print("[SECURITY] Cross-tenant access blocked.")

        SECURITY_STATE["access_denied"] = True

        return {
            "found": False,
            "error": "ACCESS_DENIED",
    }

    return {
        "found": True,
        "customer": customer,
    }


@function_tool(failure_error_function=None)
def create_task(
    idempotency_key: str,
    customer_name: str,
    team: str,
    description: str,
    priority: str,
) -> dict:

    # 1. Check if this action already succeeded before.
    if idempotency_key in PROCESSED_ACTIONS:
        existing = PROCESSED_ACTIONS[idempotency_key]

        print("\n[IDEMPOTENCY CHECK]")
        print(
            f"Action already completed as "
            f"{existing['task_id']}."
        )

        return existing

    # 2. Actually create the task.
    result = {
        "created": True,
        "task_id": "TASK-001",
        "customer": customer_name,
        "team": team,
        "priority": priority,
        "idempotency_key": idempotency_key,
    }

    # 3. Save the result BEFORE returning it.
    PROCESSED_ACTIONS[idempotency_key] = result

    print("\n[WRITE TOOL EXECUTED]")
    print(f"Task ID: {result['task_id']}")
    print(f"Customer: {customer_name}")
    print(f"Team: {team}")
    print(f"Priority: {priority}")
    print(f"Description: {description}")

    # 4. Simulate response loss AFTER task creation.
    if random.random() < 0.5:
        raise RuntimeError(
            "Task created, but response was lost"
        )

    return result