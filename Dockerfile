FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install the exact dependency snapshot validated by CI before copying source
# so dependency layers remain cacheable when application code changes.
COPY requirements.lock ./requirements.lock
RUN python -m pip install --upgrade pip \
    && pip install -r requirements.lock \
    && pip check

# Run the service as an unprivileged user. The MCP subprocess launched by the
# workflow uses this same Python runtime and inherits the container environment.
RUN addgroup --system app \
    && adduser --system --ingroup app --home /app app

COPY --chown=app:app agent_lab ./agent_lab
COPY --chown=app:app frontend ./frontend

USER app

EXPOSE 8000

# Use the platform-provided PORT when present (Render), with 8000 as the
# portable default (local Docker / Azure Container Apps configuration).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; p=os.getenv('PORT','8000'); urllib.request.urlopen(f'http://127.0.0.1:{p}/health', timeout=3).read()" || exit 1

# One worker is intentional for the first production deployment because the
# current max-concurrency tracker is process-local. Horizontal scaling will be
# enabled only after that coordination is moved to shared storage.
CMD ["sh", "-c", "exec python -m uvicorn agent_lab.api:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
