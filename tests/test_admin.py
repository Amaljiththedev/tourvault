"""Tests for the admin portal endpoints (/admin/...)."""
import os

import psycopg
import pytest

from app import db
from app.auth import hash_password

TOUR = {"hospital": "Alder Hey", "title": "Atrium", "status": "published"}


def user_id(email):
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        return conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()[0]


@pytest.mark.parametrize("path", ["/admin/stats", "/admin/tours", "/admin/users", "/admin/activity"])
def test_admin_pages_need_an_admin(client, viewer_headers, path):
    assert client.get(path).status_code == 401
    assert client.get(path, headers=viewer_headers).status_code == 403


def test_stats_count_tours_and_users(client, admin_headers, viewer_headers):
    client.post("/tours", json=TOUR, headers=admin_headers)
    client.post("/tours", json={**TOUR, "status": "draft"}, headers=admin_headers)

    stats = client.get("/admin/stats", headers=admin_headers).json()

    assert stats["tours"] == 2 and stats["published_tours"] == 1
    assert stats["users"] == 2 and stats["admins"] == 1
    assert stats["files"] == 0 and stats["storage_bytes"] == 0


def test_admin_tours_include_file_counts(client, admin_headers):
    tour_id = client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]
    db.create_asset(tour_id, "a.ply", "k1", None, 10, user_id("admin@test.com"))

    [row] = client.get("/admin/tours", headers=admin_headers).json()

    assert row["id"] == tour_id and row["file_count"] == 1 and row["size_bytes"] == 10


def test_users_list_flags_accounts_that_cannot_log_in(client, admin_headers):
    db.create_user(email="old@example.com", password_hash="")

    users = {u["email"]: u for u in client.get("/admin/users", headers=admin_headers).json()}

    assert users["admin@test.com"]["can_log_in"] is True
    assert users["old@example.com"]["can_log_in"] is False
    assert "password_hash" not in users["admin@test.com"]


def test_admin_can_promote_and_demote(client, admin_headers, viewer_headers):
    viewer = user_id("viewer@test.com")
    url = f"/admin/users/{viewer}/role"

    assert client.put(url, json={"role": "admin"}, headers=admin_headers).json()["role"] == "admin"
    # The promoted user's next request is an admin one (role is read from the database).
    assert client.get("/admin/stats", headers=viewer_headers).status_code == 200

    assert client.put(url, json={"role": "viewer"}, headers=admin_headers).json()["role"] == "viewer"
    assert client.get("/admin/stats", headers=viewer_headers).status_code == 403


def test_role_must_be_admin_or_viewer(client, admin_headers, viewer_headers):
    url = f"/admin/users/{user_id('viewer@test.com')}/role"
    assert client.put(url, json={"role": "owner"}, headers=admin_headers).status_code == 422


def test_admin_cannot_change_own_role_or_delete_self(client, admin_headers):
    me = user_id("admin@test.com")
    response = client.put(f"/admin/users/{me}/role", json={"role": "viewer"}, headers=admin_headers)
    assert response.status_code == 409
    assert client.delete(f"/admin/users/{me}", headers=admin_headers).status_code == 409


def test_last_admin_cannot_be_removed(client, admin_headers):
    # A second admin created outside the API, then the first tries to remove them
    # while they are the only other admin: fine. Removing the very last one is not.
    other = db.create_user(email="other@example.com", password_hash=hash_password("password1"))
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        conn.execute("UPDATE users SET role = 'admin' WHERE id = %s", (other["id"],))
    assert client.put(f"/admin/users/{other['id']}/role", json={"role": "viewer"}, headers=admin_headers).status_code == 200

    # Now admin@test.com is the only admin; demoting it directly must fail even
    # bypassing the "not yourself" rule.
    with pytest.raises(db.LastAdminError):
        db.set_user_role(user_id("admin@test.com"), "viewer")


def test_delete_user(client, admin_headers, viewer_headers):
    viewer = user_id("viewer@test.com")
    assert client.delete(f"/admin/users/{viewer}", headers=admin_headers).status_code == 204
    assert client.get("/me", headers=viewer_headers).status_code == 401  # their token stops working
    assert client.delete(f"/admin/users/{viewer}", headers=admin_headers).status_code == 404


def test_user_with_activity_cannot_be_deleted(client, admin_headers):
    other = db.create_user(email="other@example.com", password_hash=hash_password("password1"))
    tour_id = client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]
    db.create_asset(tour_id, "a.ply", "k1", None, 10, other["id"])  # they uploaded something

    response = client.delete(f"/admin/users/{other['id']}", headers=admin_headers)

    assert response.status_code == 409
    assert "viewer instead" in response.json()["detail"]


def test_activity_lists_newest_first_and_survives_tour_delete(client, admin_headers):
    tour_id = client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]
    client.delete(f"/tours/{tour_id}", headers=admin_headers)

    entries = client.get("/admin/activity", headers=admin_headers).json()

    assert [e["action"] for e in entries] == ["delete", "create"]
    assert entries[0]["user_email"] == "admin@test.com"
    assert entries[0]["tour_title"] is None  # the tour is gone, its history is not
