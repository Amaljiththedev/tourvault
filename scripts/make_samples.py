"""Generate the sample 3D files in samples/ from simple shapes, with no dependencies.

    python scripts/make_samples.py

- hospital.glb   a hospital building (mesh, glTF 2.0 binary) built from coloured boxes
- ward_scan.ply  a simulated 3D scan of a hospital ward (coloured point cloud, binary PLY)

The models are original and deliberately simple: they exist to exercise the
upload, processing and viewer pipeline with realistic file types.
"""
import json
import random
import struct
from pathlib import Path

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


# ---------- GLB (mesh) ----------

def box(lo, hi):
    """Vertices, normals and triangle indices for an axis-aligned box from lo to hi."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    faces = [
        ((1, 0, 0), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
        ((-1, 0, 0), [(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)]),
        ((0, 1, 0), [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]),
        ((0, -1, 0), [(x0, y0, z1), (x0, y0, z0), (x1, y0, z0), (x1, y0, z1)]),
        ((0, 0, 1), [(x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z1)]),
        ((0, 0, -1), [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)]),
    ]
    positions, normals, indices = [], [], []
    for normal, quad in faces:
        base = len(positions)
        positions += quad
        normals += [normal] * 4
        indices += [base, base + 1, base + 2, base, base + 2, base + 3]
    return positions, normals, indices


def hospital_parts():
    """Boxes grouped by material colour (RGBA). Units are metres, y is up."""
    walls, glass, accent, red, ground, roof = [], [], [], [], [], []

    ground.append(((-40, -0.2, -30), (40, 0, 30)))
    walls.append(((-12, 0, -8), (12, 24, 8)))     # main block, 6 floors
    walls.append(((-34, 0, -6), (-12, 12, 6)))    # west wing, 3 floors
    walls.append(((12, 0, -6), (34, 12, 6)))      # east wing
    roof.append(((-12.3, 24, -8.3), (12.3, 24.6, 8.3)))
    roof.append(((-34.3, 12, -6.3), (-12, 12.5, 6.3)))
    roof.append(((12, 12, -6.3), (34.3, 12.5, 6.3)))

    # A band of windows on each floor, slightly proud of the walls
    for floor in range(6):
        y = floor * 4 + 1.4
        glass.append(((-11, y, 8), (11, y + 1.6, 8.15)))
        glass.append(((-11, y, -8.15), (11, y + 1.6, -8)))
    for floor in range(3):
        y = floor * 4 + 1.4
        for x0, x1 in ((-33, -13), (13, 33)):
            glass.append(((x0, y, 6), (x1, y + 1.6, 6.15)))
            glass.append(((x0, y, -6.15), (x1, y + 1.6, -6)))

    # Entrance: glass doors under a canopy on two posts
    glass.append(((-3, 0, 8), (3, 3.2, 8.2)))
    accent.append(((-5, 3.6, 8), (5, 4.0, 13)))
    accent.append(((-4.8, 0, 12.4), (-4.4, 3.6, 12.8)))
    accent.append(((4.4, 0, 12.4), (4.8, 3.6, 12.8)))

    # Red cross on the roof
    red.append(((-3.5, 24.6, -1), (3.5, 25.2, 1)))
    red.append(((-1, 24.6, -3.5), (1, 25.2, 3.5)))

    return [
        (walls, (0.93, 0.93, 0.9, 1)),
        (glass, (0.35, 0.6, 0.85, 1)),
        (accent, (0.2, 0.45, 0.6, 1)),
        (red, (0.85, 0.1, 0.1, 1)),
        (ground, (0.45, 0.6, 0.4, 1)),
        (roof, (0.55, 0.55, 0.58, 1)),
    ]


def write_glb(path: Path, parts) -> None:
    binary = b""
    buffer_views, accessors, primitives, materials = [], [], [], []

    def add_view(data: bytes, target: int) -> int:
        nonlocal binary
        binary += b"\0" * (-len(binary) % 4)  # every view starts 4-byte aligned
        buffer_views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data), "target": target})
        binary += data
        return len(buffer_views) - 1

    for boxes, colour in parts:
        positions, normals, indices = [], [], []
        for lo, hi in boxes:
            p, n, i = box(lo, hi)
            indices += [index + len(positions) for index in i]
            positions += p
            normals += n

        pos_view = add_view(b"".join(struct.pack("<3f", *v) for v in positions), 34962)
        nor_view = add_view(b"".join(struct.pack("<3f", *v) for v in normals), 34962)
        idx_view = add_view(b"".join(struct.pack("<I", i) for i in indices), 34963)

        xs, ys, zs = zip(*positions)
        accessors.append({"bufferView": pos_view, "componentType": 5126, "count": len(positions), "type": "VEC3",
                          "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
        accessors.append({"bufferView": nor_view, "componentType": 5126, "count": len(normals), "type": "VEC3"})
        accessors.append({"bufferView": idx_view, "componentType": 5125, "count": len(indices), "type": "SCALAR"})

        materials.append({"pbrMetallicRoughness": {"baseColorFactor": list(colour), "metallicFactor": 0,
                                                   "roughnessFactor": 0.8}})
        first = len(accessors) - 3
        primitives.append({"attributes": {"POSITION": first, "NORMAL": first + 1}, "indices": first + 2,
                           "material": len(materials) - 1})

    binary += b"\0" * (-len(binary) % 4)
    gltf = {
        "asset": {"version": "2.0", "generator": "TourVault make_samples.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "Hospital"}],
        "meshes": [{"name": "Hospital", "primitives": primitives}],
        "materials": materials, "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views, "accessors": accessors,
    }
    json_bytes = json.dumps(gltf).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    body = (struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
            + struct.pack("<I4s", len(binary), b"BIN\x00") + binary)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)


# ---------- PLY (point cloud) ----------

def sample_box_surface(lo, hi, count, colour, points, rng, jitter=0.01):
    """Scatter points over the faces of a box, like a scanner hitting its surfaces."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
    areas = [dy * dz, dy * dz, dx * dz, dx * dz, dx * dy, dx * dy]
    total = sum(areas)
    for _ in range(count):
        face = rng.choices(range(6), weights=areas)[0] if total else 0
        u, v = rng.random(), rng.random()
        if face < 2:
            p = (x0 if face == 0 else x1, y0 + u * dy, z0 + v * dz)
        elif face < 4:
            p = (x0 + u * dx, y0 if face == 2 else y1, z0 + v * dz)
        else:
            p = (x0 + u * dx, y0 + v * dy, z0 if face == 4 else z1)
        p = tuple(c + rng.gauss(0, jitter) for c in p)  # scanner noise
        shade = rng.uniform(0.9, 1.05)
        points.append((*p, *(max(0, min(255, int(c * shade))) for c in colour)))


def ward_points(seed=7):
    rng = random.Random(seed)  # fixed seed: the same file every time
    points = []
    floor, wall, bed, sheet, curtain, cabinet = (
        (170, 170, 165), (225, 230, 235), (120, 125, 135), (120, 170, 220), (90, 160, 150), (200, 180, 140))

    sample_box_surface((0, -0.05, 0), (12, 0, 7), 9000, floor, points, rng)       # floor
    sample_box_surface((0, 0, 0), (12, 3, 0.05), 4000, wall, points, rng)        # back wall
    sample_box_surface((0, 0, 0), (0.05, 3, 7), 2500, wall, points, rng)         # side walls
    sample_box_surface((11.95, 0, 0), (12, 3, 7), 2500, wall, points, rng)
    for i in range(4):                                                           # four bed bays
        x = 1 + i * 2.8
        sample_box_surface((x, 0.3, 0.2), (x + 1, 0.6, 2.2), 900, bed, points, rng)
        sample_box_surface((x + 0.05, 0.6, 0.25), (x + 0.95, 0.68, 2.15), 700, sheet, points, rng)
        sample_box_surface((x + 1.3, 0, 0.2), (x + 1.8, 0.9, 0.6), 300, cabinet, points, rng)
        sample_box_surface((x - 0.4, 0.4, 2.6), (x + 2.2, 2.4, 2.62), 800, curtain, points, rng)
    return points


def write_ply(path: Path, points) -> None:
    header = "\n".join([
        "ply", "format binary_little_endian 1.0", "comment TourVault simulated ward scan",
        f"element vertex {len(points)}",
        "property float x", "property float y", "property float z",
        "property uchar red", "property uchar green", "property uchar blue",
        "end_header",
    ]) + "\n"
    body = b"".join(struct.pack("<3f3B", *p) for p in points)
    path.write_bytes(header.encode() + body)


if __name__ == "__main__":
    write_glb(SAMPLES / "hospital.glb", hospital_parts())
    points = ward_points()
    write_ply(SAMPLES / "ward_scan.ply", points)
    for name in ("hospital.glb", "ward_scan.ply"):
        print(f"{name}: {(SAMPLES / name).stat().st_size:,} bytes")
    print(f"ward_scan.ply: {len(points):,} points")
