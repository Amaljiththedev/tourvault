"""Tests for the upload endpoint's size limits. Storage and processing are faked."""
import pytest

from app import main

TOUR = {"hospital": "Alder Hey", "title": "Entrance", "status": "draft"}


@pytest.fixture
def fake_storage(monkeypatch):
    """Record uploads instead of sending them to S3, and skip background processing."""
    uploaded = []
    monkeypatch.setattr(main.storage, "ensure_bucket", lambda: None)
    monkeypatch.setattr(main.storage, "upload_file", lambda f, key, ct: uploaded.append(key))
    monkeypatch.setattr(main.processing, "process_asset", lambda asset_id: None)
    return uploaded


@pytest.fixture
def tour_id(client, admin_headers):
    return client.post("/tours", json=TOUR, headers=admin_headers).json()["id"]


def test_upload_records_bytes_actually_received(client, admin_headers, tour_id, fake_storage):
    data = b"ply\nend_header\n" + b"0" * 1000
    response = client.post(f"/tours/{tour_id}/assets", files={"file": ("scan.ply", data)}, headers=admin_headers)

    assert response.status_code == 201
    assert response.json()["size_bytes"] == len(data)
    assert len(fake_storage) == 1


def test_oversized_declared_length_is_refused_before_reading(client, admin_headers, tour_id, fake_storage, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 1000)
    data = b"0" * (1000 + main.MULTIPART_OVERHEAD_BYTES + 1)

    response = client.post(f"/tours/{tour_id}/assets", files={"file": ("big.ply", data)}, headers=admin_headers)

    assert response.status_code == 413
    assert fake_storage == []  # nothing reached storage


def test_file_just_over_the_limit_is_caught_by_exact_check(client, admin_headers, tour_id, fake_storage, monkeypatch):
    # Small enough to pass the Content-Length check (it allows for multipart
    # overhead), but the file itself is over the limit.
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 1000)

    response = client.post(f"/tours/{tour_id}/assets", files={"file": ("big.ply", b"0" * 1001)}, headers=admin_headers)

    assert response.status_code == 413
    assert fake_storage == []


def test_upload_without_content_length_is_refused(client, admin_headers, tour_id, fake_storage):
    def chunks():  # a generator body is sent chunked, with no Content-Length
        yield b"--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.ply\"\r\n\r\nply\r\n--x--\r\n"

    response = client.post(
        f"/tours/{tour_id}/assets",
        content=chunks(),
        headers={**admin_headers, "Content-Type": "multipart/form-data; boundary=x"},
    )

    assert response.status_code == 411
    assert fake_storage == []
