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

# High-confidence credential formats. Keep these deliberately specific so the
# audit stays useful instead of becoming a generic entropy scanner.
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
GENERIC_ASSIGNMENT_RE = re.compile(
    r"(?im)^\s*(?P<name>[A-Z0-9_.-]*(?:PASSWORD|SECRET|TOKEN|API[_-]?KEY)[A-Z0-9_.-]*)"
    r"\s*[:=]\s*[\"']?(?P<value>[^\s\"'#]{12,})"
)

SAFE_GENERIC_PREFIXES = (
    "${{",
    "${",
    "ci-test-",
    "test-",
    "example-",
    "placeholder-",
    "changeme",
)
SAFE_LOCAL_PASSWORDS = {"agent_lab", "postgres", "password"}
SAFE_LOCAL_HOSTS = {"localhost", "127.0.0.1", "postgres", "db"}


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
        value_lower = value.lower()
        if value.startswith(SAFE_GENERIC_PREFIXES):
            continue
        if value_lower in SAFE_LOCAL_PASSWORDS:
            continue
        # GitHub Actions secret expressions sometimes arrive without a trailing
        # brace in the regex capture because of YAML punctuation; treat any
        # expression beginning with the secrets context as safe indirection.
        if "secrets." in value_lower:
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
