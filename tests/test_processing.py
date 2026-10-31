"""Tests for the PLY and GLB header parsers used by background processing."""
import json
import struct

import pytest

from app import processing
from app.processing import parse_glb_header, parse_glb_vertex_count, parse_ply_vertex_count

VALID = b"ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nend_header\n0 0 0\n"


def test_reads_vertex_count():
    assert parse_ply_vertex_count(VALID) == 3


def test_sample_file():
    with open("samples/test.ply", "rb") as f:
        assert parse_ply_vertex_count(f.read()) == 3


@pytest.mark.parametrize("data", [b"", b"hello", b"not a ply\nelement vertex 3\n"])
def test_rejects_non_ply(data):
    with pytest.raises(ValueError, match="Not a PLY file"):
        parse_ply_vertex_count(data)


def test_missing_vertex_line():
    with pytest.raises(ValueError, match="No vertex count"):
        parse_ply_vertex_count(b"ply\nformat ascii 1.0\nend_header\n")


def test_stops_at_end_header():
    # a "vertex" line AFTER the header is data, not header: it must be ignored
    with pytest.raises(ValueError, match="No vertex count"):
        parse_ply_vertex_count(b"ply\nend_header\nelement vertex 9\n")


def test_handles_spaces_and_windows_newlines():
    assert parse_ply_vertex_count(b"ply\r\n  element vertex 42  \r\nend_header\r\n") == 42


def test_bad_number_is_rejected():
    with pytest.raises(ValueError):
        parse_ply_vertex_count(b"ply\nelement vertex abc\nend_header\n")


# ---------- GLB ----------

GLTF = {
    "asset": {"version": "2.0"},
    "accessors": [{"count": 8}, {"count": 36}, {"count": 4}],
    "meshes": [
        {"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]},
        {"primitives": [{"attributes": {"POSITION": 2, "NORMAL": 2}}]},
    ],
}


def make_glb(gltf: dict, binary: bytes = b"", magic: bytes = b"glTF", version: int = 2) -> bytes:
    """Build a GLB file: 12-byte header, then a JSON chunk padded to 4 bytes, then a BIN chunk."""
    json_bytes = json.dumps(gltf).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    body = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    if binary:
        body += struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    return struct.pack("<4sII", magic, version, 12 + len(body)) + body


def test_glb_header_and_vertex_count():
    glb = make_glb(GLTF, binary=b"\x00" * 64)
    total_length, json_length = parse_glb_header(glb)

    assert total_length == len(glb)
    assert parse_glb_vertex_count(glb[20:20 + json_length]) == 12  # 8 + 4; indices are not vertices


@pytest.mark.parametrize("data, message", [
    (b"glTF", "too short"),
    (make_glb(GLTF, magic=b"PK\x03\x04"), "Not a GLB"),
    (make_glb(GLTF, version=1), "Unsupported glTF version"),
])
def test_glb_header_rejects_bad_files(data, message):
    with pytest.raises(ValueError, match=message):
        parse_glb_header(data)


def test_glb_bad_accessor_reference_is_a_readable_error():
    with pytest.raises(ValueError, match="Invalid glTF JSON"):
        parse_glb_vertex_count(json.dumps({"meshes": [{"primitives": [{"attributes": {"POSITION": 5}}]}]}).encode())


def test_glb_length_mismatch_means_truncated_upload():
    glb = make_glb(GLTF)
    with pytest.raises(ValueError, match="were uploaded"):
        processing.glb_vertex_count({"size_bytes": len(glb) - 10, "object_key": "x.glb"}, glb)


def test_glb_json_bigger_than_first_read_is_fetched(monkeypatch):
    big = {**GLTF, "extras": {"padding": "x" * 100_000}}  # JSON chunk larger than a 64 KB first read
    glb = make_glb(big)
    asked = []

    def fake_read_start(object_key, num_bytes=64 * 1024):
        asked.append(num_bytes)
        return glb[:num_bytes]

    monkeypatch.setattr(processing.storage, "read_start", fake_read_start)
    first_read = glb[:64 * 1024]

    assert processing.glb_vertex_count({"size_bytes": len(glb), "object_key": "x.glb"}, first_read) == 12
    assert asked == [20 + parse_glb_header(glb)[1]]  # fetched exactly the JSON, not the whole file
