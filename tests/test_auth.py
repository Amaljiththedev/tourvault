"""Tests for registration, login and password hashing."""
from app.auth import hash_password, verify_password


# ---------- UNIT tests: one function, no database, no HTTP ----------

def test_password_hash_is_not_the_password():
    hashed = hash_password("secret")

    assert hashed != "secret"                      # never store the plain password
    assert hashed.startswith("$2b$")               # it is a bcrypt hash
    assert verify_password("secret", hashed) is True


def test_wrong_password_fails_verification():
    hashed = hash_password("secret")

    assert verify_password("wrong", hashed) is False


# ---------- INTEGRATION tests: HTTP + API + database together ----------
# YOUR TURN: replace each `...` with the steps in the comments.
# Use the `client` fixture: client.post("/register", json={...})


def test_register_creates_viewer(client):
    response = client.post("/register", json={"email": "new@test.com", "password": "pass123"})

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "viewer"
    assert "password" not in body
    assert "password_hash" not in body


def test_register_cannot_choose_admin(client):
    response = client.post(
        "/register",
        json={"email": "sneaky@test.com", "password": "pass123", "role": "admin"},
    )

    assert response.status_code == 201
    assert response.json()["role"] == "viewer"  # protects the privilege-escalation fix


def test_duplicate_email_returns_409(client):
    user = {"email": "dup@test.com", "password": "pass123"}
    client.post("/register", json=user)

    second = client.post("/register", json=user)

    assert second.status_code == 409


def test_login_wrong_password_returns_401(client):
    client.post("/register", json={"email": "login@test.com", "password": "rightpass"})

    response = client.post("/login", json={"email": "login@test.com", "password": "wrongpass"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_login_unknown_email_gives_same_401(client):
    response = client.post("/login", json={"email": "nobody@test.com", "password": "x"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"  # no user enumeration


def test_login_returns_token(client):
    client.post("/register", json={"email": "ok@test.com", "password": "rightpass"})

    response = client.post("/login", json={"email": "ok@test.com", "password": "rightpass"})

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert response.json()["access_token"].count(".") == 2  # header.payload.signature
