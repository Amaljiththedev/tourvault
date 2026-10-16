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
    # Act: POST /register with an email and password
    # Assert: status code is 201
    # Assert: response.json()["role"] == "viewer"
    # Assert: "password" is NOT in response.json()       (hint: `not in`)
    # Assert: "password_hash" is NOT in response.json()
    ...


def test_register_cannot_choose_admin(client):
    # Act: POST /register with email, password AND "role": "admin"
    # Assert: status code is 201
    # Assert: role in the response is still "viewer"     <- protects your security fix
    ...


def test_duplicate_email_returns_409(client):
    # Arrange: register "dup@test.com" once
    # Act: register "dup@test.com" again
    # Assert: the SECOND response has status code 409
    ...


def test_login_wrong_password_returns_401(client):
    # Arrange: register a user with password "rightpass"
    # Act: POST /login with the same email and password "wrongpass"
    # Assert: status code is 401
    # Assert: response.json()["detail"] == "Invalid email or password"
    ...
