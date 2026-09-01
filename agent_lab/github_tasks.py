import os

import httpx


class GitHubTaskConfigurationError(RuntimeError):
    pass


class GitHubTaskIntegrationError(RuntimeError):
    pass


class GitHubTaskClient:
    """Small GitHub Issues adapter used by the approved write tool.

    The idempotency key is embedded in the issue body. Before creating an
    issue, the client scans recent issues for that marker. This lets a retry
    reconcile a GitHub-side success even when the original HTTP response was
    lost before PostgreSQL could record the result.
    """

    def __init__(
        self,
        *,
        token: str,
        repository: str,
        api_base: str = "https://api.github.com",
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        token = token.strip()
        repository = repository.strip()
        if not token:
            raise GitHubTaskConfigurationError("TASK_GITHUB_TOKEN is not configured.")
        if "/" not in repository or repository.startswith("/") or repository.endswith("/"):
            raise GitHubTaskConfigurationError(
                "TASK_GITHUB_REPOSITORY must use the 'owner/repository' format."
            )

        self.token = token
        self.repository = repository
        self.api_base = api_base.rstrip("/")
        self.transport = transport

    @classmethod
    def from_env(cls) -> "GitHubTaskClient":
        return cls(
            token=os.getenv("TASK_GITHUB_TOKEN", ""),
            repository=os.getenv("TASK_GITHUB_REPOSITORY", ""),
            api_base=os.getenv("TASK_GITHUB_API_URL", "https://api.github.com"),
        )

    @staticmethod
    def idempotency_marker(idempotency_key: str) -> str:
        # Legacy marker retained so retries can still reconcile tasks created
        # before the CorrelAct product rename.
        return f"<!-- human-led-agent-idempotency:{idempotency_key} -->"

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url=self.api_base,
            headers=self._headers(),
            timeout=15.0,
            transport=self.transport,
        ) as client:
            try:
                response = await client.request(method, path, **kwargs)
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as exc:
                try:
                    message = exc.response.json().get("message", exc.response.text)
                except ValueError:
                    message = exc.response.text
                raise GitHubTaskIntegrationError(
                    f"GitHub API rejected the task request ({exc.response.status_code}): {message}"
                ) from exc

    async def find_existing_issue(self, idempotency_key: str) -> dict | None:
        marker = self.idempotency_marker(idempotency_key)

        # Direct repository listing avoids depending on GitHub search indexing,
        # which can lag immediately after an issue is created. Five pages is
        # plenty for this lab/demo while keeping retry reconciliation bounded.
        for page in range(1, 6):
            response = await self._request(
                "GET",
                f"/repos/{self.repository}/issues",
                params={
                    "state": "all",
                    "per_page": 100,
                    "page": page,
                    "sort": "created",
                    "direction": "desc",
                },
            )
            issues = response.json()
            for issue in issues:
                if "pull_request" in issue:
                    continue
                if marker in (issue.get("body") or ""):
                    return issue

            if len(issues) < 100:
                break

        return None

    def _result_from_issue(
        self,
        issue: dict,
        *,
        customer_name: str,
        team: str,
        priority: str,
        idempotency_key: str,
    ) -> dict:
        number = int(issue["number"])
        return {
            "created": True,
            "provider": "github",
            "task_id": f"GH-{number}",
            "issue_number": number,
            "issue_url": issue["html_url"],
            "repository": self.repository,
            "customer": customer_name,
            "team": team,
            "priority": priority,
            "idempotency_key": idempotency_key,
        }

    async def create_or_get_issue(
        self,
        *,
        idempotency_key: str,
        customer_name: str,
        team: str,
        description: str,
        priority: str,
    ) -> tuple[dict, bool]:
        """Return a GitHub issue result and whether this call created it."""

        existing = await self.find_existing_issue(idempotency_key)
        if existing is not None:
            return (
                self._result_from_issue(
                    existing,
                    customer_name=customer_name,
                    team=team,
                    priority=priority,
                    idempotency_key=idempotency_key,
                ),
                False,
            )

        marker = self.idempotency_marker(idempotency_key)
        title = f"[{priority.upper()}] {customer_name} — {team} action"
        body = (
            "## Approved Action\n\n"
            f"**Customer:** {customer_name}\n\n"
            f"**Target team:** {team}\n\n"
            f"**Priority:** {priority}\n\n"
            f"**Description:** {description}\n\n"
            "---\n"
            "Created by CorrelAct after explicit human approval.\n\n"
            f"{marker}"
        )

        try:
            response = await self._request(
                "POST",
                f"/repos/{self.repository}/issues",
                json={"title": title, "body": body},
            )
            issue = response.json()
        except httpx.RequestError:
            # The request may have reached GitHub even if our client never saw
            # the response. Reconcile by marker before letting workflow retry.
            existing = await self.find_existing_issue(idempotency_key)
            if existing is None:
                raise
            return (
                self._result_from_issue(
                    existing,
                    customer_name=customer_name,
                    team=team,
                    priority=priority,
                    idempotency_key=idempotency_key,
                ),
                False,
            )

        return (
            self._result_from_issue(
                issue,
                customer_name=customer_name,
                team=team,
                priority=priority,
                idempotency_key=idempotency_key,
            ),
            True,
        )
