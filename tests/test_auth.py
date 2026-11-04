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
    response = client.post("/register", json={"email": "new@test.com", "password": "pass1234"})

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "viewer"
    assert "password" not in body
    assert "password_hash" not in body


def test_register_cannot_choose_admin(client):
    response = client.post(
        "/register",
        json={"email": "sneaky@test.com", "password": "pass1234", "role": "admin"},
    )

    assert response.status_code == 201
    assert response.json()["role"] == "viewer"  # protects the privilege-escalation fix


def test_duplicate_email_returns_409(client):
    user = {"email": "dup@test.com", "password": "pass1234"}
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


# ---------- Regression tests: the "email only" login bug ----------

def test_register_rejects_empty_password(client):
    response = client.post("/register", json={"email": "blank@test.com", "password": ""})
    assert response.status_code == 422


def test_register_rejects_whitespace_and_short_passwords(client):
    for password in ["        ", "short"]:
        response = client.post("/register", json={"email": "weak@test.com", "password": password})
        assert response.status_code == 422


def test_register_rejects_password_over_72_bytes(client):
    response = client.post("/register", json={"email": "long@test.com", "password": "a" * 73})
    assert response.status_code == 422


def test_login_without_password_is_refused(client):
    client.post("/register", json={"email": "real@test.com", "password": "rightpass"})

    assert client.post("/login", json={"email": "real@test.com"}).status_code == 422
    assert client.post("/login", json={"email": "real@test.com", "password": ""}).status_code == 422


def test_old_empty_password_account_cannot_log_in(client):
    # An account stored with a hash of "" (created before validation existed).
    from app import db
    db.create_user(email="legacy@test.com", password_hash=hash_password(""))

    assert client.post("/login", json={"email": "legacy@test.com", "password": ""}).status_code == 422
    assert client.post("/login", json={"email": "legacy@test.com", "password": "anything"}).status_code == 401


def test_very_long_login_password_is_401_not_500(client):
    client.post("/register", json={"email": "ok@test.com", "password": "rightpass"})
    response = client.post("/login", json={"email": "ok@test.com", "password": "a" * 200})
    assert response.status_code == 401


def test_email_is_case_insensitive(client):
    client.post("/register", json={"email": "Mixed@Test.com", "password": "rightpass"})

    assert client.post("/register", json={"email": "mixed@test.com", "password": "rightpass"}).status_code == 409
    assert client.post("/login", json={"email": "MIXED@test.com", "password": "rightpass"}).status_code == 200


def test_me_returns_current_user(client, viewer_headers):
    response = client.get("/me", headers=viewer_headers)
    assert response.status_code == 200
    assert response.json()["email"] == "viewer@test.com"
    assert response.json()["role"] == "viewer"


def test_me_rejects_missing_and_forged_tokens(client):
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer not.a.token"}).status_code == 401


def test_docs_token_endpoint_uses_same_rules(client):
    client.post("/register", json={"email": "form@test.com", "password": "rightpass"})
    assert client.post("/token", data={"username": "form@test.com", "password": ""}).status_code in (401, 422)
    assert client.post("/token", data={"username": "form@test.com", "password": "rightpass"}).status_code == 200
