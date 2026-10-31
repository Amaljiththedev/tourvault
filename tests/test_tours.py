"""Tests for the tour endpoints: permissions, validation, filtering and auditing."""
import pytest

from app import db

TOUR = {"hospital": "Alder Hey", "title": "Entrance", "status": "draft"}


def test_list_tours_requires_login(client):
    assert client.get("/tours").status_code == 401


def test_viewer_can_list_tours(client, viewer_headers):
    response = client.get("/tours", headers=viewer_headers)

    assert response.status_code == 200
    assert response.json() == []


def test_viewer_cannot_create_tour(client, viewer_headers):
    response = client.post("/tours", json=TOUR, headers=viewer_headers)

    assert response.status_code == 403


def test_get_missing_tour_returns_404(client, viewer_headers):
    assert client.get("/tours/999", headers=viewer_headers).status_code == 404


def test_invalid_tour_returns_422(client, admin_headers):
    response = client.post("/tours", json={"hospital": "Alder Hey"}, headers=admin_headers)

    assert response.status_code == 422


def test_filter_by_hospital(client, admin_headers):
    client.post("/tours", json=TOUR, headers=admin_headers)
    client.post("/tours", json={**TOUR, "hospital": "Royal Liverpool"}, headers=admin_headers)

    response = client.get("/tours", params={"hospital": "Alder Hey"}, headers=admin_headers)

    assert response.status_code == 200
    assert [t["hospital"] for t in response.json()] == ["Alder Hey"]


def test_pagination_limit_and_offset(client, admin_headers):
    for i in range(3):
        client.post("/tours", json={**TOUR, "title": f"Tour {i}"}, headers=admin_headers)

    page = client.get("/tours", params={"limit": 2, "offset": 1}, headers=admin_headers).json()

    assert [t["title"] for t in page] == ["Tour 1", "Tour 2"]


def test_limit_over_100_is_rejected(client, admin_headers):
    assert client.get("/tours", params={"limit": 500}, headers=admin_headers).status_code == 422


def test_sql_injection_in_filter_is_harmless(client, admin_headers):
    client.post("/tours", json=TOUR, headers=admin_headers)

    attack = "x'; DROP TABLE tours; --"
    response = client.get("/tours", params={"hospital": attack}, headers=admin_headers)

    assert response.status_code == 200
    assert response.json() == []
    assert len(client.get("/tours", headers=admin_headers).json()) == 1  # table still there


def test_create_update_delete_are_audited(client, admin_headers):
    tour_id = client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]
    client.put(f"/tours/{tour_id}", json={**TOUR, "status": "published", "version": 1}, headers=admin_headers)
    client.delete(f"/tours/{tour_id}", headers=admin_headers)
    client.put("/tours/999", json={**TOUR, "version": 1}, headers=admin_headers)  # 404: must NOT be logged

    with db.get_db_connection() as conn:
        rows = conn.execute(
            "SELECT action, tour_id FROM audit_log ORDER BY id"
        ).fetchall()

    assert [(r["action"], r["tour_id"]) for r in rows] == [
        ("create", tour_id),
        ("update", tour_id),
        ("delete", tour_id),
    ]


def _break_audit_log(monkeypatch):
    """Make every audit insert fail, like a crash between the two writes."""
    def failing_log_action(*args, **kwargs):
        raise RuntimeError("audit write failed")
    monkeypatch.setattr(db, "log_action", failing_log_action)


def _all_tours():
    with db.get_db_connection() as conn:
        return conn.execute("SELECT id, title FROM tours ORDER BY id").fetchall()


def test_failed_audit_rolls_back_create(client, admin_headers, monkeypatch):
    _break_audit_log(monkeypatch)
    with pytest.raises(RuntimeError):
        client.post("/tours", json=TOUR, headers=admin_headers)

    assert _all_tours() == []  # the tour row was rolled back with the audit row


def test_failed_audit_rolls_back_update_and_delete(client, admin_headers, monkeypatch):
    tour_id = client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]
    _break_audit_log(monkeypatch)

    with pytest.raises(RuntimeError):
        client.put(f"/tours/{tour_id}", json={**TOUR, "title": "Changed", "version": 1}, headers=admin_headers)
    with pytest.raises(RuntimeError):
        client.delete(f"/tours/{tour_id}", headers=admin_headers)

    assert _all_tours() == [{"id": tour_id, "title": "Entrance"}]  # unchanged and still there


def test_update_bumps_version(client, admin_headers):
    tour = client.post("/tours", json=TOUR, headers=admin_headers).json()
    assert tour["version"] == 1

    response = client.put(f"/tours/{tour['id']}", json={**TOUR, "title": "New", "version": 1}, headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["version"] == 2


def test_stale_update_is_rejected_not_lost(client, admin_headers):
    """Two admins load version 1. The first saves; the second must get 409, not overwrite."""
    tour_id = client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]

    first = client.put(f"/tours/{tour_id}", json={**TOUR, "title": "First edit", "version": 1}, headers=admin_headers)
    second = client.put(f"/tours/{tour_id}", json={**TOUR, "title": "Second edit", "version": 1}, headers=admin_headers)

    assert first.status_code == 200
    assert second.status_code == 409
    assert client.get(f"/tours/{tour_id}", headers=admin_headers).json()["title"] == "First edit"

    with db.get_db_connection() as conn:
        actions = [r["action"] for r in conn.execute("SELECT action FROM audit_log ORDER BY id").fetchall()]
    assert actions == ["create", "update"]  # the refused update was not audited


def test_update_without_version_is_rejected(client, admin_headers):
    tour_id = client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]
    assert client.put(f"/tours/{tour_id}", json=TOUR, headers=admin_headers).status_code == 422
