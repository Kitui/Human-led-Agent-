import sys
from pathlib import Path

from mcp.server import MCPServer


# workflow.py launches this file directly as a stdio child process. Add the
# repository root so package imports work the same way they do under `-m`.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent_lab.customers import lookup_customer
from agent_lab.db import async_session_maker


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
