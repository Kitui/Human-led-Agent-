import json

import httpx

from agent_lab.github_tasks import GitHubTaskClient


REPOSITORY = "example/tasks"
TOKEN = "test-token"


def make_issue(number: int, marker: str) -> dict:
    return {
        "number": number,
        "html_url": f"https://github.com/{REPOSITORY}/issues/{number}",
        "body": f"Approved action\n\n{marker}",
    }


async def test_create_or_get_issue_creates_real_github_issue_payload():
    seen = {"post": None}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=[])
        if request.method == "POST":
            seen["post"] = json.loads(request.content.decode())
            return httpx.Response(
                201,
                json={
                    "number": 42,
                    "html_url": f"https://github.com/{REPOSITORY}/issues/42",
                    "body": seen["post"]["body"],
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = GitHubTaskClient(
        token=TOKEN,
        repository=REPOSITORY,
        transport=httpx.MockTransport(handler),
    )

    result, created_now = await client.create_or_get_issue(
        idempotency_key="abc123",
        customer_name="ACME",
        team="Billing",
        description="Resolve the disputed invoice.",
        priority="high",
    )

    assert created_now is True
    assert result["provider"] == "github"
    assert result["task_id"] == "GH-42"
    assert result["issue_number"] == 42
    assert result["repository"] == REPOSITORY
    assert seen["post"]["title"] == "[HIGH] ACME — Billing action"
    assert "Resolve the disputed invoice." in seen["post"]["body"]
    assert client.idempotency_marker("abc123") in seen["post"]["body"]


async def test_existing_github_issue_is_reused_by_idempotency_marker():
    marker = GitHubTaskClient.idempotency_marker("already-there")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=[make_issue(77, marker)])
        raise AssertionError("A matching GitHub issue must prevent a second POST.")

    client = GitHubTaskClient(
        token=TOKEN,
        repository=REPOSITORY,
        transport=httpx.MockTransport(handler),
    )

    result, created_now = await client.create_or_get_issue(
        idempotency_key="already-there",
        customer_name="ACME",
        team="Billing",
        description="Resolve the disputed invoice.",
        priority="high",
    )

    assert created_now is False
    assert result["task_id"] == "GH-77"
    assert result["issue_url"].endswith("/issues/77")


async def test_lost_post_response_reconciles_created_issue_before_retrying():
    state = {"post_attempted": False}
    marker = GitHubTaskClient.idempotency_marker("lost-response")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            if not state["post_attempted"]:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[make_issue(88, marker)])

        if request.method == "POST":
            state["post_attempted"] = True
            raise httpx.ReadTimeout("response lost after GitHub accepted the issue", request=request)

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = GitHubTaskClient(
        token=TOKEN,
        repository=REPOSITORY,
        transport=httpx.MockTransport(handler),
    )

    result, created_now = await client.create_or_get_issue(
        idempotency_key="lost-response",
        customer_name="ACME",
        team="Billing",
        description="Resolve the disputed invoice.",
        priority="high",
    )

    assert state["post_attempted"] is True
    assert created_now is False
    assert result["task_id"] == "GH-88"
    assert result["issue_url"].endswith("/issues/88")
