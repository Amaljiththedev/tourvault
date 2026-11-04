import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app import db
from app.models import BCRYPT_MAX_BYTES


# ---------- Passwords ----------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    password_bytes = password.encode("utf-8")
    # An empty password never matches, and bcrypt 5 raises on more than 72
    # bytes. Both are simply a wrong password, never a crash.
    if not password_bytes or len(password_bytes) > BCRYPT_MAX_BYTES:
        return False
    try:
        return bcrypt.checkpw(password_bytes, password_hash.encode("utf-8"))
    except ValueError:  # a malformed hash in the database
        return False


# A real bcrypt hash of a random value. When the email is unknown, login still
# runs one bcrypt check against this, so a wrong email takes as long as a
# wrong password and response times do not reveal which accounts exist.
_DUMMY_HASH = hash_password(os.urandom(16).hex())


def authenticate(email: str, password: str):
    """Return the user if the email and password match, otherwise None."""
    user = db.get_user_by_email(email)
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return user


# ---------- Tokens ----------

DEV_SECRET = "dev-only-secret-change-me-at-least-32-bytes"
SECRET_KEY = os.getenv("SECRET_KEY", DEV_SECRET)
ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "30"))

if len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY must be at least 32 characters")


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    to_encode.update({"iat": now, "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
    except jwt.InvalidTokenError:
        raise ValueError("Invalid or expired token")


# tokenUrl points at the form-based /token endpoint, so the Authorize button
# in /docs works. The app itself logs in through the JSON /login endpoint.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = verify_access_token(token)
    except ValueError:
        raise _unauthorized("Invalid or expired token")

    user_id = payload.get("sub")
    if user_id is None or not str(user_id).isdigit():
        raise _unauthorized("Invalid token")

    # Load the user fresh on every request: the role comes from the database,
    # not from the token, so a demoted or deleted user loses access at once.
    user = db.get_user_by_id(int(user_id))
    if user is None:
        raise _unauthorized("User not found")
    return user


def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
