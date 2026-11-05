import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from psycopg.errors import ForeignKeyViolation, UniqueViolation

from app import db, panorama, processing, storage
from app.auth import ACCESS_TOKEN_MINUTES, authenticate, create_access_token, get_current_user, hash_password, require_admin
from app.models import (
    ActivityEntry, AdminStats, AdminTour, AdminUser, Asset, AssetPlacement, RoleUpdate,
    Token, Tour, TourCreate, TourUpdate, UserCreate, UserLogin, UserOut,
)

log = logging.getLogger("tourvault")


# ---------- 1. Create the app ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Add columns an older database is missing (idempotent).
    if os.getenv("ENSURE_SCHEMA_ON_STARTUP", "1") == "1":
        try:
            db.ensure_schema()
        except Exception:
            log.exception("Could not update the database schema")
    # Resume assets a previous run left half-processed. Runs in a thread so a
    # slow storage call never delays startup; set RESUME_ASSETS_ON_STARTUP=0 to skip.
    if os.getenv("RESUME_ASSETS_ON_STARTUP", "1") == "1":
        def resume():
            try:
                count = processing.resume_unfinished_assets()
                if count:
                    log.info("Resumed %d unfinished asset(s)", count)
            except Exception:
                log.exception("Could not resume unfinished assets")
        threading.Thread(target=resume, daemon=True).start()
    yield


app = FastAPI(title="TourVault", lifespan=lifespan)


# Starlette writes the whole upload to a temp file BEFORE the endpoint runs, so
# the size check inside upload_asset only happens after a huge file has already
# been received. This rejects oversized uploads up front, from the declared
# Content-Length, before any of the body is read.
MULTIPART_OVERHEAD_BYTES = 64 * 1024  # boundaries and part headers around the file


@app.middleware("http")
async def reject_oversized_uploads(request: Request, call_next):
    if request.method == "POST" and request.url.path.endswith("/assets"):
        length = request.headers.get("content-length")
        if length is None or not length.isdigit():
            # Without a declared length we cannot refuse early, so require one.
            return JSONResponse({"detail": "Content-Length required"}, status_code=411)
        if int(length) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES:
            return JSONResponse({"detail": "File exceeds the maximum upload size"}, status_code=413)
    return await call_next(request)


# Added after the middleware above, so it wraps it: even a 411/413 refusal
# carries CORS headers and the browser can read the error message.
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# ---------- 2. Health check ----------
@app.get("/health")
def health():
    return {"status": "ok"}


# The demo frontend: one static page that calls this same API.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app/")


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
    return db.create_tour(tour, admin["id"])  # tour row + audit row, one transaction


# ---------- 6. Update a tour ----------
@app.put("/tours/{tour_id}", response_model=Tour)
def update_tour(tour_id: int, tour: TourUpdate, admin=Depends(require_admin)):
    # A 404 or 409 rolls back, so nothing is logged. 409 = someone else changed it first.
    return db.update_tour(tour_id, tour, admin["id"])


# ---------- 7. Delete a tour ----------
@app.delete("/tours/{tour_id}")
def delete_tour(tour_id: int, admin=Depends(require_admin)):
    # Asset rows go with the tour (ON DELETE CASCADE), but their files live in
    # storage, so note the keys first and remove the files once the delete commits.
    object_keys = [
        key
        for asset in db.list_assets(tour_id)
        for key in [asset["object_key"], *(asset["face_keys"] or [])]
    ]
    deleted = db.delete_tour(tour_id, admin["id"])
    for key in object_keys:
        try:
            storage.delete_file(key)
        except Exception:
            log.exception("Could not delete object %s", key)
    return deleted



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

def _issue_token(email: str, password: str) -> dict:
    db_user = authenticate(email, password)
    if db_user is None:
        # Same message for a wrong email and a wrong password: no user enumeration.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({"sub": str(db_user["id"]), "role": db_user["role"]})
    return {"access_token": token, "token_type": "bearer", "expires_in": ACCESS_TOKEN_MINUTES * 60}


@app.post("/login", response_model=Token)
def login(user: UserLogin):
    return _issue_token(user.email, user.password)


@app.post("/token", response_model=Token, include_in_schema=False)
def token_for_docs(form: OAuth2PasswordRequestForm = Depends()):
    # Form-encoded twin of /login for the Authorize button in /docs.
    if not form.password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return _issue_token(form.username.strip().lower(), form.password)


@app.get("/me", response_model=UserOut)
def me(user=Depends(get_current_user)):
    # Lets the frontend check a stored token is still valid and get the real role.
    return user


# ---------- 8. 3D assets ----------
# .glb / .ply are 3D models. .zip is a 360 scan point: six cube-map faces (see app/panorama.py).
ALLOWED_EXTENSIONS = {".glb", ".ply", ".zip"}
# Browsers send no type or a generic one for 3D files, so the server sets it.
CONTENT_TYPES = {".glb": "model/gltf-binary", ".ply": "application/octet-stream", ".zip": "application/zip"}
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

    # 2. Exact size check. file.size is the number of bytes Starlette actually
    #    received, not a number the client claimed. The middleware above has
    #    already refused anything whose declared length was too big.
    if file.size is None or file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File exceeds the maximum upload size"
        )
    if file.size == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty")

    # 3. Tour must exist (raises 404 if missing)
    db.get_tour(tour_id)

    # 4. Generate a safe storage key
    object_key = f"tours/{tour_id}/{uuid4()}{ext}"

    # 5. Upload file to storage
    storage.ensure_bucket()
    content_type = CONTENT_TYPES[ext]
    storage.upload_file(file.file, object_key, content_type)

    # 6. Save metadata
    asset = db.create_asset(
        tour_id,
        file.filename,
        object_key,
        content_type,
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
    if asset["status"] != "ready":
        raise HTTPException(status_code=409, detail="Asset is not ready yet")
    response = {"url": storage.presigned_download_url(asset["object_key"]), "expires_in_seconds": 600}
    if asset["kind"] == "panorama":
        # One signed link per face, in panorama.FACE_ORDER, so the viewer
        # loads the images straight from storage like any other file.
        response["faces"] = dict(zip(panorama.FACE_ORDER, (storage.presigned_download_url(k) for k in asset["face_keys"])))
    return response


@app.post("/assets/{asset_id}/reprocess", response_model=Asset)
def reprocess_asset(asset_id: int, background_tasks: BackgroundTasks, admin=Depends(require_admin)):
    asset = db.get_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset["status"] == "processing":
        raise HTTPException(status_code=409, detail="Asset is already being processed")
    db.reset_asset_for_reprocessing(asset_id)
    background_tasks.add_task(processing.process_asset, asset_id)
    return db.get_asset(asset_id)


@app.put("/assets/{asset_id}/placement", response_model=Asset)
def set_asset_placement(asset_id: int, placement: AssetPlacement, admin=Depends(require_admin)):
    """Place a 360 scan point in the tour (or clear it with nulls), so the
    viewer can show the other points around it and move between them."""
    asset = db.get_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset["kind"] != "panorama":
        raise HTTPException(status_code=409, detail="Only 360 scan points can be placed")
    position, heading = panorama.check_placement(placement.position, placement.heading)
    return db.set_placement(asset_id, position, heading)


@app.delete("/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: int, admin=Depends(require_admin)):
    deleted = db.delete_asset(asset_id)
    if deleted is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    # The upload itself and, for a panorama, its six stored faces.
    for key in [deleted["object_key"], *(deleted["face_keys"] or [])]:
        try:
            storage.delete_file(key)
        except Exception:
            # The metadata is gone either way; an orphaned object costs storage, not correctness.
            log.exception("Could not delete object %s", key)








# ---------- 9. Legacy-compatible endpoint (Day 11: strangler fig) ----------
# Replaces the old PHP /tours.php. Existing clients still call /tours.php through
# the router, so this MUST return exactly the same JSON shape as the PHP version.
@app.get("/legacy/tours")
def legacy_tours(hospital: str | None = None):
    # Safe SQL (placeholders inside db.get_all_tours), unlike the PHP version.
    tours = db.get_all_tours(limit=100, offset=0, hospital=hospital)

    legacy_list = []
    for tour in tours:
        legacy_list.append({
            "tour_id": tour.id,
            "hospital_name": tour.hospital,
            "tour_title": tour.title.upper(),          # PHP used strtoupper(): keep the quirk
            "is_published": 1 if tour.status == "published" else 0,
        })

    return {"count": len(legacy_list), "tours": legacy_list}


# ---------- 9. Admin portal ----------
# Everything here needs an admin. The web app's /admin pages use these.

LAST_ADMIN = "There must always be at least one admin"


@app.get("/admin/stats", response_model=AdminStats)
def admin_stats(admin=Depends(require_admin)):
    return db.admin_stats()


@app.get("/admin/tours", response_model=list[AdminTour])
def admin_tours(admin=Depends(require_admin)):
    return db.admin_tours()


@app.get("/admin/users", response_model=list[AdminUser])
def admin_users(admin=Depends(require_admin)):
    return db.list_users()


@app.put("/admin/users/{user_id}/role", response_model=AdminUser)
def admin_set_role(user_id: int, body: RoleUpdate, admin=Depends(require_admin)):
    # You cannot change your own role: an admin demoting themself by accident
    # would lock themself out mid-session.
    if user_id == admin["id"]:
        raise HTTPException(status_code=409, detail="You cannot change your own role")
    try:
        return db.set_user_role(user_id, body.role)
    except db.LastAdminError:
        raise HTTPException(status_code=409, detail=LAST_ADMIN)


@app.delete("/admin/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, admin=Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=409, detail="You cannot delete your own account")
    try:
        db.delete_user(user_id)
    except db.LastAdminError:
        raise HTTPException(status_code=409, detail=LAST_ADMIN)
    except ForeignKeyViolation:
        # Their uploads and audit entries must keep pointing at someone.
        raise HTTPException(
            status_code=409,
            detail="This user has uploads or activity on record. Make them a viewer instead.",
        )


@app.get("/admin/activity", response_model=list[ActivityEntry])
def admin_activity(limit: int = Query(default=50, ge=1, le=200), admin=Depends(require_admin)):
    return db.list_activity(limit)
