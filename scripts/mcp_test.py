import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from agents import Agent, Runner
from agents.mcp import MCPServerStdio


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv()

from agent_lab.db import init_db


async def main():
    await init_db()

    mcp_server_path = ROOT / "agent_lab" / "mcp_server.py"

    async with MCPServerStdio(
        name="Customer Operations MCP",
        params={
            "command": sys.executable,
            "args": [
                str(mcp_server_path),
            ],
            "env": os.environ.copy(),
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
