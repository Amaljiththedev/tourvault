"""Tests for the PLY header parser used by background processing."""
import pytest

from app.processing import parse_ply_vertex_count

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
