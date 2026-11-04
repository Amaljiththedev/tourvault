"""Background processing for uploaded 3D assets.

Lifecycle of an asset:  uploaded -> processing -> ready | failed
"""
import json
import struct

from app import db, storage

# A GLB file starts with a 12-byte header (magic "glTF", version, total length)
# followed by the first chunk's 8-byte header (length, type "JSON").
GLB_HEADER_BYTES = 20
MAX_GLB_JSON_BYTES = 16 * 1024 * 1024  # refuse absurd JSON chunks instead of downloading them


def parse_ply_vertex_count(data: bytes) -> int:

    text = data.decode("utf-8", errors="ignore")
    lines = text.splitlines()


    if not lines or lines[0].strip()!="ply":
        raise ValueError("Not a PLY file")


    for line in lines[1:]:
        line = line.strip()

        if line == 'end_header':
            break

        if line.startswith("element vertex"):
            parts = line.split()
            return int(parts[2])

    raise ValueError("No vertex count in header")


def parse_glb_header(data: bytes) -> tuple[int, int]:
    """Return (total file length, JSON chunk length) from the first 20 bytes of a GLB."""
    if len(data) < GLB_HEADER_BYTES:
        raise ValueError("File too short to be a GLB")

    # "<" = little-endian, "4s" = 4 raw bytes, "I" = unsigned 32-bit integer
    magic, version, total_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError("Not a GLB file")
    if version != 2:
        raise ValueError(f"Unsupported glTF version {version}")

    json_length, chunk_type = struct.unpack_from("<I4s", data, 12)
    if chunk_type != b"JSON":
        raise ValueError("First GLB chunk is not JSON")

    return total_length, json_length


def parse_glb_vertex_count(json_bytes: bytes) -> int:
    """Sum the POSITION counts of every mesh primitive described in the glTF JSON."""
    try:
        gltf = json.loads(json_bytes)
        accessors = gltf.get("accessors", [])
        total = 0
        for mesh in gltf.get("meshes", []):
            for primitive in mesh.get("primitives", []):
                position = primitive.get("attributes", {}).get("POSITION")
                if position is not None:
                    total += accessors[position]["count"]
        return total
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
        raise ValueError(f"Invalid glTF JSON: {exc}") from exc


def glb_vertex_count(asset: dict, start: bytes) -> int:
    total_length, json_length = parse_glb_header(start)

    # The header states the whole file's length. A mismatch means the upload
    # was truncated or the file is corrupt.
    if total_length != asset["size_bytes"]:
        raise ValueError(
            f"GLB header says {total_length} bytes but {asset['size_bytes']} were uploaded"
        )
    if json_length > MAX_GLB_JSON_BYTES:
        raise ValueError("GLB JSON chunk is too large")

    end = GLB_HEADER_BYTES + json_length
    if end > len(start):
        # The JSON did not fit in the first read: fetch exactly as much as needed.
        start = storage.read_start(asset["object_key"], end)
    return parse_glb_vertex_count(start[GLB_HEADER_BYTES:end])


def process_asset(asset_id: int) -> None:
    """Runs in the background after an upload. Never raises: failures are recorded."""
    # Claim the asset first: only one job may move it from 'uploaded' to
    # 'processing'. If the claim fails, another job has it or it is finished.
    if not db.claim_asset_for_processing(asset_id):
        return
    asset = db.get_asset(asset_id)
    if asset is None:
        return

    try:
        header_bytes = storage.read_start(asset["object_key"])

        if asset["object_key"].endswith(".ply"):
            vertex_count = parse_ply_vertex_count(header_bytes)
        else:
            vertex_count = glb_vertex_count(asset, header_bytes)

        db.update_asset_status(asset_id, "ready", vertex_count=vertex_count)

    except Exception as exc:  # any problem -> mark failed with a readable reason
        db.update_asset_status(asset_id, "failed", error=str(exc)[:500] or type(exc).__name__)


def resume_unfinished_assets() -> int:
    """Run at startup. Background tasks live in memory, so a restart loses any
    that were queued or running and those assets would sit in 'uploaded' or
    'processing' forever. This puts them back in the queue."""
    ids = db.list_unfinished_asset_ids()
    for asset_id in ids:
        db.reset_asset_for_reprocessing(asset_id)
        process_asset(asset_id)
    return len(ids)
