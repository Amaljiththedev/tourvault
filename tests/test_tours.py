"""Tests for the tour endpoints: permissions, validation, filtering and auditing."""
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
    client.put(f"/tours/{tour_id}", json={**TOUR, "status": "published"}, headers=admin_headers)
    client.delete(f"/tours/{tour_id}", headers=admin_headers)
    client.put("/tours/999", json=TOUR, headers=admin_headers)  # fails with 404: must NOT be logged

    with db.get_db_connection() as conn:
        rows = conn.execute(
            "SELECT action, tour_id FROM audit_log ORDER BY id"
        ).fetchall()

    assert [(r["action"], r["tour_id"]) for r in rows] == [
        ("create", tour_id),
        ("update", tour_id),
        ("delete", tour_id),
    ]
