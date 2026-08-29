from mcp.server import MCPServer

from .customers import lookup_customer
from .db import async_session_maker


mcp = MCPServer("Customer Operations")


@mcp.tool()
async def get_customer(
    customer_name: str,
    tenant_id: str,
) -> dict:
    """Retrieve persistent customer information for the requesting tenant."""

    async with async_session_maker() as db:
        result = await lookup_customer(
            db,
            customer_name=customer_name,
            tenant_id=tenant_id,
        )
    return result.to_dict()


if __name__ == "__main__":
    mcp.run(transport="stdio")
