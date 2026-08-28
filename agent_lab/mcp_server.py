from mcp.server import MCPServer


mcp = MCPServer("Customer Operations")


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


@mcp.tool()
def get_customer(
    customer_name: str,
    tenant_id: str,
) -> dict:
    """
    Retrieve customer information for the requesting tenant.
    """

    customer = CUSTOMERS.get(
        customer_name.upper()
    )

    if customer is None:
        return {
            "found": False,
            "error": "NOT_FOUND",
        }

    if customer["tenant_id"] != tenant_id:
        return {
            "found": False,
            "error": "ACCESS_DENIED",
        }

    return {
        "found": True,
        "customer": customer,
    }


if __name__ == "__main__":
    mcp.run(transport="stdio")