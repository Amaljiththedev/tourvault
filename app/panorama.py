"""360 scan points (panoramas) stored as cube maps.

This is how capture platforms such as Matterport deliver a tour: every scan
point is six square JPGs, one per side of a cube around the camera. TourVault
stores those six images as they are (no conversion) and the viewer draws them
on the inside of a cube.

An upload is a .zip holding the six faces, named either:

  Matterport style   face0 .. face5   (0 up, 1 front, 2 right, 3 back, 4 left, 5 down)
  by direction       front, back, left, right, up/top, down/bottom

The order above for Matterport was worked out from real tiles: the edges of
face1 -> face2 -> face3 -> face4 line up going right, face0's bottom edge meets
face1's top, and face5's top edge meets face1's bottom.

The zip may also hold a point.json saying where the scan point is, so the
viewer can show the other points and walk between them:

  {"position": [x, y, z], "heading": degrees}

position is in metres with y up. heading is how far the cube is turned about
the vertical axis, counter-clockwise seen from above. For a Matterport sweep
it is the sweep's rotation.y minus 180 (checked against Matterport's own
player at two scan points and two camera directions).
"""
from __future__ import annotations

import io
import json
import math
import zipfile
from pathlib import PurePosixPath

from PIL import Image

# The order faces are stored in, and returned to the viewer in.
FACE_ORDER = ["front", "right", "back", "left", "up", "down"]

MATTERPORT_FACES = {"face0": "up", "face1": "front", "face2": "right", "face3": "back", "face4": "left", "face5": "down"}
NAMED_FACES = {
    "front": "front", "back": "back", "left": "left", "right": "right",
    "up": "up", "top": "up", "down": "down", "bottom": "down",
}
IMAGE_TYPES = {".jpg": ("JPEG", "image/jpeg"), ".jpeg": ("JPEG", "image/jpeg"), ".png": ("PNG", "image/png")}

# Checked before anything is extracted, so a "zip bomb" cannot fill memory.
MAX_ENTRIES = 50
MAX_FACE_BYTES = 20 * 1024 * 1024
MAX_FACE_PIXELS = 8192
MAX_POINT_FILE_BYTES = 64 * 1024
MAX_COORDINATE = 1_000_000


class PanoramaError(ValueError):
    """The zip is not a usable cube map. The message is shown to users."""


def _face_name(filename: str) -> tuple[str, str] | None:
    path = PurePosixPath(filename)
    stem, ext = path.stem.lower(), path.suffix.lower()
    if ext not in IMAGE_TYPES:
        return None
    face = MATTERPORT_FACES.get(stem) or NAMED_FACES.get(stem)
    return (face, ext) if face else None


def read_cube_faces(data: bytes) -> tuple[dict[str, tuple[bytes, str]], int]:
    """Validate a cube-map zip. Returns ({face: (image bytes, extension)}, face size in pixels)."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PanoramaError("Not a valid zip file") from exc

    entries = [i for i in archive.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
    if len(entries) > MAX_ENTRIES:
        raise PanoramaError("Zip has too many files")

    faces: dict[str, tuple[bytes, str]] = {}
    for info in entries:
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts:
            raise PanoramaError("Zip contains an unsafe path")
        named = _face_name(info.filename)
        if named is None:
            continue
        face, ext = named
        if face in faces:
            raise PanoramaError(f"Zip has more than one '{face}' face")
        if info.file_size > MAX_FACE_BYTES:
            raise PanoramaError(f"Face '{face}' is too large")
        faces[face] = (archive.read(info), ext)

    missing = [f for f in FACE_ORDER if f not in faces]
    if missing:
        raise PanoramaError(f"Cube map is missing faces: {', '.join(missing)}")

    size = None
    for face, (image_bytes, ext) in faces.items():
        try:
            # Image.open only reads the header: the size check costs nothing.
            with Image.open(io.BytesIO(image_bytes)) as image:
                fmt, (width, height) = image.format, image.size
        except Exception as exc:
            raise PanoramaError(f"Face '{face}' is not a readable image") from exc
        if fmt != IMAGE_TYPES[ext][0]:
            raise PanoramaError(f"Face '{face}' is not really a {ext} file")
        if width != height:
            raise PanoramaError(f"Face '{face}' must be square (it is {width}x{height})")
        if width > MAX_FACE_PIXELS:
            raise PanoramaError(f"Face '{face}' is larger than {MAX_FACE_PIXELS}px")
        if size is None:
            size = width
        elif width != size:
            raise PanoramaError("All six faces must be the same size")
    return faces, size


def content_type(ext: str) -> str:
    return IMAGE_TYPES[ext][1]


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def check_placement(position, heading) -> tuple[list[float] | None, float | None]:
    """Validate a placement and normalise the heading to [0, 360)."""
    if position is not None:
        if not (isinstance(position, (list, tuple)) and len(position) == 3 and all(map(_number, position))):
            raise PanoramaError("position must be three numbers [x, y, z]")
        if any(abs(v) > MAX_COORDINATE for v in position):
            raise PanoramaError("position is out of range")
        position = [float(v) for v in position]
    if heading is not None:
        if not _number(heading):
            raise PanoramaError("heading must be a number of degrees")
        heading = float(heading) % 360.0
    return position, heading


def read_placement(data: bytes) -> tuple[list[float] | None, float | None]:
    """The optional point.json in a cube-map zip. (None, None) if there is none."""
    archive = zipfile.ZipFile(io.BytesIO(data))
    found = [i for i in archive.infolist() if PurePosixPath(i.filename).name.lower() == "point.json"]
    if not found:
        return None, None
    if len(found) > 1:
        raise PanoramaError("Zip has more than one point.json")
    if found[0].file_size > MAX_POINT_FILE_BYTES:
        raise PanoramaError("point.json is too large")
    try:
        info = json.loads(archive.read(found[0]))
    except (ValueError, UnicodeDecodeError) as exc:
        raise PanoramaError("point.json is not valid JSON") from exc
    if not isinstance(info, dict):
        raise PanoramaError('point.json must be an object like {"position": [x, y, z], "heading": 0}')
    return check_placement(info.get("position"), info.get("heading"))
