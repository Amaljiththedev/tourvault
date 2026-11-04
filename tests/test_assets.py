"""Tests for the upload endpoint's size limits. Storage and processing are faked."""
import pytest

from app import main
from app.processing import process_asset as real_process_asset  # before any fixture stubs it

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


def test_empty_file_is_refused(client, admin_headers, tour_id, fake_storage):
    response = client.post(f"/tours/{tour_id}/assets", files={"file": ("empty.ply", b"")}, headers=admin_headers)
    assert response.status_code == 400
    assert fake_storage == []


def test_server_sets_content_type(client, admin_headers, tour_id, fake_storage):
    response = client.post(
        f"/tours/{tour_id}/assets",
        files={"file": ("model.glb", b"glTF" + b"0" * 100, "text/plain")},
        headers=admin_headers,
    )
    assert response.json()["content_type"] == "model/gltf-binary"


def test_download_refused_until_ready(client, admin_headers, tour_id, fake_storage):
    asset = client.post(f"/tours/{tour_id}/assets", files={"file": ("scan.ply", b"ply\n")}, headers=admin_headers).json()
    assert client.get(f"/assets/{asset['id']}/download", headers=admin_headers).status_code == 409


def test_stuck_asset_is_resumed(client, admin_headers, tour_id, fake_storage, monkeypatch):
    from app import db, processing
    asset = client.post(f"/tours/{tour_id}/assets", files={"file": ("scan.ply", b"ply\n")}, headers=admin_headers).json()
    db.update_asset_status(asset["id"], "processing")  # as if the server died mid-job
    monkeypatch.setattr(processing, "process_asset", real_process_asset)

    monkeypatch.setattr(processing.storage, "read_start", lambda key, n=0: b"ply\nelement vertex 42\nend_header\n")
    assert processing.resume_unfinished_assets() == 1

    resumed = db.get_asset(asset["id"])
    assert resumed["status"] == "ready"
    assert resumed["vertex_count"] == 42


def test_process_asset_runs_only_once(client, admin_headers, tour_id, fake_storage, monkeypatch):
    from app import db, processing
    asset = client.post(f"/tours/{tour_id}/assets", files={"file": ("scan.ply", b"ply\n")}, headers=admin_headers).json()
    calls = []
    monkeypatch.setattr(processing, "process_asset", real_process_asset)
    monkeypatch.setattr(processing.storage, "read_start", lambda key, n=0: calls.append(key) or b"ply\nelement vertex 1\nend_header\n")

    processing.process_asset(asset["id"])
    processing.process_asset(asset["id"])  # second call finds it already done

    assert len(calls) == 1


def test_reprocess_and_delete_need_admin(client, admin_headers, viewer_headers, tour_id, fake_storage, monkeypatch):
    monkeypatch.setattr(main.storage, "delete_file", lambda key: None)
    asset = client.post(f"/tours/{tour_id}/assets", files={"file": ("scan.ply", b"ply\n")}, headers=admin_headers).json()

    assert client.post(f"/assets/{asset['id']}/reprocess", headers=viewer_headers).status_code == 403
    assert client.post(f"/assets/{asset['id']}/reprocess", headers=admin_headers).status_code == 200
    assert client.delete(f"/assets/{asset['id']}", headers=viewer_headers).status_code == 403
    assert client.delete(f"/assets/{asset['id']}", headers=admin_headers).status_code == 204
    assert client.get(f"/assets/{asset['id']}", headers=admin_headers).status_code == 404


def test_deleting_tour_removes_its_files_from_storage(client, admin_headers, tour_id, fake_storage, monkeypatch):
    removed = []
    monkeypatch.setattr(main.storage, "delete_file", lambda key: removed.append(key))
    client.post(f"/tours/{tour_id}/assets", files={"file": ("scan.ply", b"ply")}, headers=admin_headers)

    assert client.delete(f"/tours/{tour_id}", headers=admin_headers).status_code == 200
    assert removed == fake_storage  # the same key that was uploaded
