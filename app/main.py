import os
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from psycopg.errors import UniqueViolation

from app import db, processing, storage
from app.auth import create_access_token, verify_password, hash_password, get_current_user, require_admin
from app.models import Asset, TourCreate, Tour, UserCreate, UserOut, UserLogin, Token

# ---------- 1. Create the app ----------
app = FastAPI(title="TourVault")


# ---------- 2. Health check ----------
@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- 3. Get all tours ----------
@app.get("/tours", response_model=list[Tour])
def get_all_tours(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),hospital: str | None = None,
    user=Depends(get_current_user),
):
    return db.get_all_tours(limit=limit, offset=offset,hospital=hospital)


# ---------- 4. Get a tour by ID ----------
@app.get("/tours/{tour_id}", response_model=Tour)
def get_tour(tour_id: int, user=Depends(get_current_user)):
    return db.get_tour(tour_id)

# ---------- 5. Create a tour ----------
@app.post("/tours", status_code=201, response_model=Tour)
def create_tour(tour: TourCreate, admin=Depends(require_admin)):
    new_tour = db.create_tour(tour)
    db.log_action(admin["id"], "create", new_tour["id"])
    return new_tour


# ---------- 6. Update a tour ----------
@app.put("/tours/{tour_id}", response_model=Tour)
def update_tour(tour_id: int, tour: TourCreate, admin=Depends(require_admin)):
    updated_tour = db.update_tour(tour_id, tour)  # raises 404 first if missing, so nothing is logged
    db.log_action(admin["id"], "update", tour_id)
    return updated_tour


# ---------- 7. Delete a tour ----------
@app.delete("/tours/{tour_id}")
def delete_tour(tour_id: int, admin=Depends(require_admin)):
    deleted_tour = db.delete_tour(tour_id)
    db.log_action(admin["id"], "delete", tour_id)
    return deleted_tour



# ------user

@app.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=UserOut
)
def register(user: UserCreate):
    try:
        # Everyone who self-registers is a viewer. The server decides roles, not the client.
        return db.create_user(
            email=user.email,
            password_hash=hash_password(user.password),
        )
    except UniqueViolation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered"
        )

@app.post("/login", response_model=Token)
def login(user: UserLogin):
    db_user = db.get_user_by_email(user.email)

    if (
        db_user is None
        or not verify_password(
            user.password,
            db_user["password_hash"]
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    token = create_access_token(
        {
            "sub": str(db_user["id"]),
            "role": db_user["role"]
        }
    )

    return {
        "access_token": token,
        "token_type": "bearer"
    }


# ---------- 8. 3D assets ----------
ALLOWED_EXTENSIONS = {".glb", ".ply"}
MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB




@app.post(
    "/tours/{tour_id}/assets",
    status_code=201,
    response_model=Asset
)
def upload_asset(
    tour_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    admin=Depends(require_admin)
):
    # 1. Extension check
    _, ext = os.path.splitext(file.filename or "")
    ext = ext.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File extension not allowed"
        )

    # 2. Size check
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds the maximum upload size"
        )

    # 3. Tour must exist (raises 404 if missing)
    db.get_tour(tour_id)

    # 4. Generate a safe storage key
    object_key = f"tours/{tour_id}/{uuid4()}{ext}"

    # 5. Upload file to storage
    storage.ensure_bucket()
    storage.upload_file(
        file.file,
        object_key,
        file.content_type
    )

    # 6. Save metadata
    asset = db.create_asset(
        tour_id,
        file.filename,
        object_key,
        file.content_type,
        file.size,
        admin["id"]
    )

    # 7. Process it in the background AFTER the response is sent:
    #    the client gets 201 immediately and polls GET /assets/{id} for the status.
    background_tasks.add_task(processing.process_asset, asset["id"])
    return asset


@app.get("/tours/{tour_id}/assets", response_model=list[Asset])
def list_tour_assets(tour_id: int, user=Depends(get_current_user)):
    db.get_tour(tour_id)  # 404 if the tour does not exist
    return db.list_assets(tour_id)


@app.get("/assets/{asset_id}", response_model=Asset)
def get_asset_status(asset_id: int, user=Depends(get_current_user)):
    """Poll this to see processing progress: uploaded -> processing -> ready | failed."""
    asset = db.get_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@app.get("/assets/{asset_id}/download")
def download_asset(asset_id: int, user=Depends(get_current_user)):
    asset = db.get_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    # A temporary signed link: the browser downloads straight from storage,
    # so large 3D files never pass through this API.
    return {"url": storage.presigned_download_url(asset["object_key"]), "expires_in_seconds": 600}






