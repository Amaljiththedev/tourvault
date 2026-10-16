"""Two worked examples to copy the pattern from. Write your own tests in new files."""


def test_health_returns_ok(client):
    # Arrange: nothing to set up (the `client` fixture comes from conftest.py)
    # Act
    response = client.get("/health")
    # Assert
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_admin_can_create_tour(client, admin_headers):
    # Arrange
    new_tour = {"hospital": "Alder Hey", "title": "Entrance", "status": "draft"}
    # Act
    response = client.post("/tours", json=new_tour, headers=admin_headers)
    # Assert
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Entrance"
    assert body["id"] == 1  # tables are emptied before each test, so ids restart at 1
