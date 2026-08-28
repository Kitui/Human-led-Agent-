import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import UserORM
from .models import AuthenticatedUser

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(hours=1)


def _secret_key() -> str:
    secret_key = os.getenv("JWT_SECRET_KEY")
    if not secret_key:
        raise RuntimeError("JWT_SECRET_KEY environment variable is not set.")
    return secret_key


async def authenticate_user(db: AsyncSession, username: str, password: str) -> AuthenticatedUser | None:
    """Look up `username` in the real users table and verify `password`
    against its stored bcrypt hash. Returns None for both an unknown
    username and a wrong password -- callers must not let the two be
    distinguished."""

    user = await db.get(UserORM, username)
    if user is None:
        return None

    if not bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8")):
        return None

    return AuthenticatedUser(username=user.username, tenant_ids=user.tenant_ids)


def create_access_token(user: AuthenticatedUser) -> str:
    payload = {
        "sub": user.username,
        "tenant_ids": user.tenant_ids,
        "exp": datetime.now(timezone.utc) + ACCESS_TOKEN_EXPIRE,
    }
    return jwt.encode(payload, _secret_key(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> AuthenticatedUser:
    try:
        payload = jwt.decode(token, _secret_key(), algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token.") from exc

    return AuthenticatedUser(username=payload["sub"], tenant_ids=payload["tenant_ids"])


async def get_current_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    token = authorization.removeprefix("Bearer ").strip()
    return decode_access_token(token)
