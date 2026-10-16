"""Shared test setup. pytest loads this file automatically before any test.

Tests use their OWN database (tourvault_test) and their OWN storage bucket,
so running them never touches your development data.
"""
import os
from pathlib import Path

import psycopg

# These must be set BEFORE the app is imported, because app/db.py and
# app/storage.py read them at import time.
ADMIN_URL = "postgresql://postgres:postgres@localhost:5432/postgres"
TEST_DB = "tourvault_test"
os.environ["DATABASE_URL"] = f"postgresql://postgres:postgres@localhost:5432/{TEST_DB}"
os.environ["S3_BUCKET"] = "tour-assets-test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.auth import hash_password  # noqa: E402
from app.main import app  # noqa: E402

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text()


@pytest.fixture(scope="session", autouse=True)
def test_database():
    """Once per test run: create the test database (if needed) and build a fresh schema."""
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        conn.execute(SCHEMA)
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    """Before EVERY test: empty all tables, so each test starts from a known state."""
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        conn.execute("TRUNCATE assets, audit_log, tours, users RESTART IDENTITY CASCADE;")
    yield


@pytest.fixture
def client():
    """A fake HTTP client that calls the app directly, with no real server running."""
    return TestClient(app)


def _make_user(email: str, password: str, role: str) -> None:
    user = db.create_user(email=email, password_hash=hash_password(password))
    if role != "viewer":
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
            conn.execute("UPDATE users SET role = %s WHERE id = %s", (role, user["id"]))


def _token(client: TestClient, email: str, password: str) -> str:
    response = client.post("/login", json={"email": email, "password": password})
    return response.json()["access_token"]


@pytest.fixture
def admin_headers(client):
    """Authorization header for a logged-in ADMIN."""
    _make_user("admin@test.com", "adminpass", "admin")
    return {"Authorization": f"Bearer {_token(client, 'admin@test.com', 'adminpass')}"}


@pytest.fixture
def viewer_headers(client):
    """Authorization header for a logged-in VIEWER."""
    _make_user("viewer@test.com", "viewerpass", "viewer")
    return {"Authorization": f"Bearer {_token(client, 'viewer@test.com', 'viewerpass')}"}
