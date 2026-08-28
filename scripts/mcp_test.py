import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
from agents import Agent, Runner
from agents.mcp import MCPServerStdio


load_dotenv()


async def main():
    mcp_server_path = Path(__file__).resolve().parents[1] / "agent_lab" / "mcp_server.py"

    async with MCPServerStdio(
        name="Customer Operations MCP",
        params={
            "command": sys.executable,
            "args": [
                str(mcp_server_path),
            ],
        },
    ) as server:

        agent = Agent(
            name="MCP Test Agent",
            instructions="""
You investigate customer issues.

If a customer is mentioned, use the get_customer
MCP tool before answering.

Always pass the tenant ID provided by the user.
""",
            mcp_servers=[
                server,
            ],
        )

        result = await Runner.run(
            agent,
            """
Tenant ID: tenant_red

ACME says their renewal is blocked.
"""
        )

        print("\n--- RESULT ---")
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main())