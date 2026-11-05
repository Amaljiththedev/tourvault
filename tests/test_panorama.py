"""Tests for 360 scan points stored as cube maps (app/panorama.py)."""
import io
import zipfile

import pytest
from PIL import Image

from app import panorama, processing
from app.panorama import PanoramaError
from app.processing import process_asset as real_process_asset

MATTERPORT = [f"face{i}" for i in range(6)]
NAMED = ["front", "back", "left", "right", "up", "down"]


def jpg(size=(16, 16), colour=(120, 80, 40)):
    out = io.BytesIO()
    Image.new("RGB", size, colour).save(out, "JPEG")
    return out.getvalue()


def make_zip(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return out.getvalue()


def cube(names=MATTERPORT, ext=".jpg", size=(16, 16)):
    # A different colour per face, so tests can tell which file went where.
    return {f"{n}{ext}": jpg(size, (i * 40, 0, 0)) for i, n in enumerate(names)}


# ---------- validation ----------

def test_matterport_names_map_to_directions():
    faces, size = panorama.read_cube_faces(make_zip(cube()))

    assert size == 16
    assert set(faces) == set(panorama.FACE_ORDER)
    # face0 is the ceiling and face1 the front in Matterport's layout.
    assert faces["up"][0] == cube()["face0.jpg"]
    assert faces["front"][0] == cube()["face1.jpg"]
    assert faces["down"][0] == cube()["face5.jpg"]


def test_direction_names_and_top_bottom_work():
    names = ["front", "back", "left", "right", "top", "bottom"]
    faces, _ = panorama.read_cube_faces(make_zip(cube(names)))
    assert set(faces) == set(panorama.FACE_ORDER)


def test_faces_inside_a_folder_are_found():
    files = {f"point1/{name}": data for name, data in cube().items()}
    faces, _ = panorama.read_cube_faces(make_zip(files))
    assert len(faces) == 6


def test_missing_face_is_a_readable_error():
    files = cube()
    del files["face5.jpg"]
    with pytest.raises(PanoramaError, match="missing faces: down"):
        panorama.read_cube_faces(make_zip(files))


def test_duplicate_face_is_refused():
    files = cube()
    files["up.jpg"] = jpg()  # face0 is also "up"
    with pytest.raises(PanoramaError, match="more than one 'up'"):
        panorama.read_cube_faces(make_zip(files))


def test_faces_must_be_square():
    with pytest.raises(PanoramaError, match="square"):
        panorama.read_cube_faces(make_zip(cube(size=(32, 16))))


def test_faces_must_match_in_size():
    files = cube()
    files["face3.jpg"] = jpg((32, 32))
    with pytest.raises(PanoramaError, match="same size"):
        panorama.read_cube_faces(make_zip(files))


def test_a_renamed_non_image_is_refused():
    files = cube()
    files["face2.jpg"] = b"not an image"
    with pytest.raises(PanoramaError, match="not a readable image"):
        panorama.read_cube_faces(make_zip(files))


def test_a_png_named_jpg_is_refused():
    out = io.BytesIO()
    Image.new("RGB", (16, 16)).save(out, "PNG")
    files = cube()
    files["face2.jpg"] = out.getvalue()
    with pytest.raises(PanoramaError, match="not really a .jpg"):
        panorama.read_cube_faces(make_zip(files))


def test_path_traversal_is_refused():
    files = {f"../{name}": data for name, data in cube().items()}
    with pytest.raises(PanoramaError, match="unsafe path"):
        panorama.read_cube_faces(make_zip(files))


def test_not_a_zip_is_refused():
    with pytest.raises(PanoramaError, match="valid zip"):
        panorama.read_cube_faces(b"PK definitely not")


# ---------- through the API and background processing ----------

TOUR = {"hospital": "Alder Hey", "title": "Atrium", "status": "draft"}


@pytest.fixture
def memory_storage(monkeypatch):
    """A dict instead of S3, so processing runs for real end to end."""
    files = {}

    def upload_file(fileobj, key, content_type):
        files[key] = fileobj.read()

    s = processing.storage
    monkeypatch.setattr(s, "ensure_bucket", lambda: None)
    monkeypatch.setattr(s, "upload_file", upload_file)
    monkeypatch.setattr(s, "upload_bytes", lambda data, key, ct: files.__setitem__(key, data))
    monkeypatch.setattr(s, "read_all", lambda key: files[key])
    monkeypatch.setattr(s, "delete_file", lambda key: files.pop(key, None))
    monkeypatch.setattr(s, "presigned_download_url", lambda key, expires_seconds=600: f"signed://{key}")
    monkeypatch.setattr(processing, "process_asset", real_process_asset)
    return files


def upload(client, headers, name, data):
    tour_id = client.post("/tours", json=TOUR, headers=headers).json()["id"]
    response = client.post(f"/tours/{tour_id}/assets", files={"file": (name, data)}, headers=headers)
    assert response.status_code == 201, response.text
    return client.get(f"/assets/{response.json()['id']}", headers=headers).json()


def test_cube_map_upload_stores_six_faces(client, admin_headers, memory_storage):
    asset = upload(client, admin_headers, "point1.zip", make_zip(cube()))

    assert asset["status"] == "ready", asset["error"]
    assert asset["kind"] == "panorama"
    assert asset["face_size"] == 16
    assert len(memory_storage) == 7  # the zip plus six faces


def test_download_returns_a_signed_link_per_face(client, admin_headers, viewer_headers, memory_storage):
    asset = upload(client, admin_headers, "point1.zip", make_zip(cube()))

    body = client.get(f"/assets/{asset['id']}/download", headers=viewer_headers).json()

    assert list(body["faces"]) == panorama.FACE_ORDER
    front_key = body["faces"]["front"].removeprefix("signed://")
    assert memory_storage[front_key] == cube()["face1.jpg"]  # stored exactly as uploaded


def test_model_download_has_no_faces(client, admin_headers, memory_storage, monkeypatch):
    monkeypatch.setattr(processing.storage, "read_start", lambda key, n=0: b"ply\nelement vertex 5\nend_header\n")
    asset = upload(client, admin_headers, "scan.ply", b"ply\nelement vertex 5\nend_header\n")

    assert asset["kind"] == "model"
    assert "faces" not in client.get(f"/assets/{asset['id']}/download", headers=admin_headers).json()


def test_bad_cube_map_is_marked_failed(client, admin_headers, memory_storage):
    files = cube()
    del files["face0.jpg"]
    asset = upload(client, admin_headers, "broken.zip", make_zip(files))

    assert asset["status"] == "failed"
    assert "missing faces: up" in asset["error"]


def test_deleting_a_panorama_removes_its_faces(client, admin_headers, memory_storage):
    asset = upload(client, admin_headers, "point1.zip", make_zip(cube()))

    assert client.delete(f"/assets/{asset['id']}", headers=admin_headers).status_code == 204
    assert memory_storage == {}


def test_reprocessing_replaces_old_faces(client, admin_headers, memory_storage):
    asset = upload(client, admin_headers, "point1.zip", make_zip(cube()))
    client.post(f"/assets/{asset['id']}/reprocess", headers=admin_headers)

    assert client.get(f"/assets/{asset['id']}", headers=admin_headers).json()["status"] == "ready"
    assert len(memory_storage) == 7  # still one zip and six faces, no leftovers


# ---------- placement (for moving between scan points) ----------

def test_point_json_gives_position_and_heading():
    files = {**cube(), "point.json": b'{"position": [1.5, 1.4, -2], "heading": -90}'}
    assert panorama.read_placement(make_zip(files)) == ([1.5, 1.4, -2.0], 270.0)


def test_zip_without_point_json_has_no_placement():
    assert panorama.read_placement(make_zip(cube())) == (None, None)


@pytest.mark.parametrize("body, message", [
    (b"{not json", "not valid JSON"),
    (b"[1, 2, 3]", "must be an object"),
    (b'{"position": [1, 2]}', "three numbers"),
    (b'{"position": [1, true, 3]}', "three numbers"),
    (b'{"position": [1, 2, 1e9]}', "out of range"),
    (b'{"heading": "north"}', "heading must be a number"),
])
def test_bad_point_json_is_a_readable_error(body, message):
    with pytest.raises(PanoramaError, match=message):
        panorama.read_placement(make_zip({**cube(), "point.json": body}))


def test_upload_with_point_json_is_placed(client, admin_headers, memory_storage):
    files = {**cube(), "point.json": b'{"position": [-37.2, 1.48, -11.1], "heading": 273.6}'}
    asset = upload(client, admin_headers, "point1.zip", make_zip(files))

    assert asset["status"] == "ready", asset["error"]
    assert asset["position"] == [-37.2, 1.48, -11.1]
    assert asset["heading"] == 273.6


def test_admin_can_place_a_scan_point(client, admin_headers, viewer_headers, memory_storage):
    asset = upload(client, admin_headers, "point1.zip", make_zip(cube()))
    url = f"/assets/{asset['id']}/placement"
    body = {"position": [1, 2, 3], "heading": 450}

    assert client.put(url, json=body, headers=viewer_headers).status_code == 403
    placed = client.put(url, json=body, headers=admin_headers).json()
    assert placed["position"] == [1, 2, 3] and placed["heading"] == 90

    # Reprocessing a zip that has no point.json keeps the placement.
    client.post(f"/assets/{asset['id']}/reprocess", headers=admin_headers)
    assert client.get(f"/assets/{asset['id']}", headers=admin_headers).json()["position"] == [1, 2, 3]

    cleared = client.put(url, json={"position": None, "heading": None}, headers=admin_headers).json()
    assert cleared["position"] is None and cleared["heading"] is None


def test_placement_is_validated(client, admin_headers, memory_storage, monkeypatch):
    asset = upload(client, admin_headers, "point1.zip", make_zip(cube()))
    url = f"/assets/{asset['id']}/placement"
    assert client.put(url, json={"position": [1, 2]}, headers=admin_headers).status_code == 422
    assert client.put(url, json={"position": [1, 2, 1e12]}, headers=admin_headers).status_code == 422

    monkeypatch.setattr(processing.storage, "read_start", lambda key, n=0: b"ply\nelement vertex 5\nend_header\n")
    model = upload(client, admin_headers, "scan.ply", b"ply\nelement vertex 5\nend_header\n")
    assert client.put(f"/assets/{model['id']}/placement", json={}, headers=admin_headers).status_code == 409
