"""Fail CI when committed repository history contains likely credentials.

This intentionally scans *git blobs across all reachable history*, not only the
current working tree, because CorrelAct will be made public for the WebMCP
Challenge. Findings report only the rule and path; matched values are never
printed into CI logs.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import PurePosixPath

MAX_BLOB_BYTES = 2_000_000

# High-confidence credential formats. These checks stay intentionally strict
# and run against every text blob in repository history.
PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("openai_api_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    ("github_classic_pat", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("github_fine_grained_pat", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("azure_storage_key", re.compile(r"(?i)AccountKey=[A-Za-z0-9+/=]{24,}")),
)

SENSITIVE_FILENAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.prod",
    "id_rsa",
    "id_ed25519",
}
SENSITIVE_SUFFIXES = {".pem", ".p12", ".pfx", ".key"}

DB_URL_RE = re.compile(
    r"(?i)postgres(?:ql)?(?:\+[a-z0-9_]+)?://"
    r"(?P<user>[^\s:/]+):(?P<password>[^\s@]+)@(?P<host>[^\s/:]+)"
)

# Generic assignments are deliberately same-line only. `\s*` is NOT used
# around the separator because it can consume a newline, turning an empty
# `.env` variable into a false match against the next line.
GENERIC_ASSIGNMENT_RE = re.compile(
    r"(?im)^[ \t]*(?P<name>[A-Z0-9_.-]*(?:PASSWORD|SECRET|TOKEN|API[_-]?KEY)[A-Z0-9_.-]*)"
    r"[ \t]*[:=][ \t]*[\"']?(?P<value>[^\s\"'#]{12,})"
)

SAFE_GENERIC_PREFIXES = (
    "${{",
    "${",
    "ci-test-",
    "test-",
    "example-",
    "placeholder-",
    "changeme",
    "replace-me",
    "dummy-",
    "your-",
    "your_",
    "use_",
    "choose_",
)
SAFE_LOCAL_PASSWORDS = {"agent_lab", "postgres", "password", "pass"}
SAFE_LOCAL_HOSTS = {"localhost", "127.0.0.1", "postgres", "db", "internal-host"}

# Expressions below are code/config indirection rather than literal secrets.
SAFE_EXPRESSION_MARKERS = (
    "os.getenv(",
    "os.environ",
    "getenv(",
    "secrets.",
    "settings.",
    "process.env",
    "import.meta.env",
    "window.",
)


def git(*args: str, text: bool = True) -> str | bytes:
    return subprocess.check_output(["git", *args], text=text)


def reachable_blobs() -> dict[str, set[str]]:
    blobs: dict[str, set[str]] = {}
    for line in git("rev-list", "--objects", "--all").splitlines():
        object_id, _, path = line.partition(" ")
        if not path:
            continue
        try:
            object_type = git("cat-file", "-t", object_id).strip()
        except subprocess.CalledProcessError:
            continue
        if object_type != "blob":
            continue
        blobs.setdefault(object_id, set()).add(path)
    return blobs


def is_sensitive_path(path: str) -> bool:
    p = PurePosixPath(path)
    name = p.name.lower()
    if name in SENSITIVE_FILENAMES:
        return True
    return p.suffix.lower() in SENSITIVE_SUFFIXES


def looks_like_safe_expression(value: str) -> bool:
    value_lower = value.lower()
    if value.startswith(SAFE_GENERIC_PREFIXES):
        return True
    if value_lower in SAFE_LOCAL_PASSWORDS:
        return True
    if any(marker in value_lower for marker in SAFE_EXPRESSION_MARKERS):
        return True
    # Function calls / template expressions are code, not literal credential
    # material. High-confidence token patterns above still catch a real token
    # even if somebody embeds one inside source code.
    if any(char in value for char in "(){}[]"):
        return True
    return False


def scan_blob(object_id: str, paths: set[str]) -> list[tuple[str, str]]:
    findings: list[tuple[str, str]] = []
    size = int(git("cat-file", "-s", object_id).strip())
    if size == 0:
        return findings

    # A committed sensitive filename is itself a release risk even if its
    # content no longer matches a known token format.
    for path in paths:
        if is_sensitive_path(path):
            findings.append(("sensitive_file_in_history", path))

    if size > MAX_BLOB_BYTES:
        return findings

    raw = git("cat-file", "blob", object_id, text=False)
    if b"\x00" in raw:
        return findings
    text = raw.decode("utf-8", errors="ignore")

    for rule, pattern in PATTERNS:
        if pattern.search(text):
            findings.extend((rule, path) for path in paths)

    for match in DB_URL_RE.finditer(text):
        host = match.group("host").lower()
        password = match.group("password")
        if host not in SAFE_LOCAL_HOSTS and password.lower() not in SAFE_LOCAL_PASSWORDS:
            findings.extend(("database_url_with_literal_password", path) for path in paths)

    for match in GENERIC_ASSIGNMENT_RE.finditer(text):
        value = match.group("value")
        if looks_like_safe_expression(value):
            continue
        findings.extend(("literal_secret_assignment", path) for path in paths)

    return findings


def main() -> int:
    try:
        blobs = reachable_blobs()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"Security audit could not inspect git history: {exc}", file=sys.stderr)
        return 2

    findings: set[tuple[str, str]] = set()
    for object_id, paths in blobs.items():
        findings.update(scan_blob(object_id, paths))

    if findings:
        print("Public-release security audit FAILED.")
        print("Potential committed credential material was found. Values are intentionally redacted.")
        for rule, path in sorted(findings):
            print(f"- {rule}: {path}")
        print("Rotate any affected credential before making the repository public, then remove it from git history.")
        return 1

    print(f"Public-release security audit passed: scanned {len(blobs)} unique historical blobs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
