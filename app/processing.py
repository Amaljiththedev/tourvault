"""Background processing for uploaded 3D assets.

Lifecycle of an asset:  uploaded -> processing -> ready | failed
"""
from app import db, storage


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


def process_asset(asset_id: int) -> None:
    """Runs in the background after an upload. Never raises: failures are recorded."""
    asset = db.get_asset(asset_id)
    if asset is None:
        return

    db.update_asset_status(asset_id, "processing")

    try:
        header_bytes = storage.read_start(asset["object_key"])

        if asset["object_key"].endswith(".ply"):
            vertex_count = parse_ply_vertex_count(header_bytes)
        else:
            vertex_count = None  # .glb parsing is a later improvement

        db.update_asset_status(asset_id, "ready", vertex_count=vertex_count)

    except Exception as exc:  # any problem -> mark failed with a readable reason
        db.update_asset_status(asset_id, "failed", error=str(exc))
