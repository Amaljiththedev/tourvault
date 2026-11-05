from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator

# bcrypt only looks at the first 72 bytes of a password, and bcrypt 5 raises an
# error for anything longer. So the API refuses longer passwords up front
# instead of crashing with a 500 or silently ignoring the end of the password.
BCRYPT_MAX_BYTES = 72
MIN_PASSWORD_LENGTH = 8

TourStatus = Literal["draft", "published"]
NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class TourCreate(BaseModel):
    hospital: NonEmptyText
    title: NonEmptyText
    status: TourStatus


class TourUpdate(TourCreate):
    # The version the client last read. If the tour changed since, the update is refused.
    version: int


class Tour(BaseModel):
    id: int
    hospital: str
    title: str
    status: str
    version: int
    created_at: datetime | None = None


def _normalise_email(value: str) -> str:
    # One account per address, whatever case it is typed in.
    return value.strip().lower()


class UserCreate(BaseModel):
    # No `role` here on purpose: the client must never choose its own permissions.
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return _normalise_email(value)

    @field_validator("password")
    @classmethod
    def password_rules(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Password cannot be blank")
        if len(value.encode("utf-8")) > BCRYPT_MAX_BYTES:
            raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes")
        return value


class UserOut(BaseModel):
    # What the API returns about a user. Never includes the password or its hash.
    id: int
    email: EmailStr
    role: Literal["admin", "viewer"]
    created_at: datetime


class UserLogin(BaseModel):
    email: EmailStr
    # min_length=1: an empty password is never a valid login, even for an old
    # account that was created before the registration rules existed.
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return _normalise_email(value)


class Token(BaseModel):
    access_token: str
    token_type: str
    expires_in: int


class Asset(BaseModel):
    id: int
    tour_id: int
    filename: str
    object_key: str
    content_type: str | None
    size_bytes: int
    status: str
    vertex_count: int | None = None
    error: str | None = None
    kind: Literal["model", "panorama"] | None = None
    face_size: int | None = None
    position: list[float] | None = None
    heading: float | None = None
    created_at: datetime


Coordinate = Annotated[float, Field(allow_inf_nan=False, ge=-1_000_000, le=1_000_000)]


class AssetPlacement(BaseModel):
    """Where a 360 scan point sits in the tour, for moving between points.
    position: [x, y, z] in metres, y up. heading: degrees the cube is turned
    about the vertical axis (counter-clockwise seen from above)."""
    position: tuple[Coordinate, Coordinate, Coordinate] | None = None
    heading: Annotated[float, Field(allow_inf_nan=False, ge=-36_000, le=36_000)] | None = None


# ---------- Admin portal ----------

class AdminStats(BaseModel):
    tours: int
    published_tours: int
    files: int
    scan_points: int
    models: int
    processing_files: int
    failed_files: int
    storage_bytes: int
    users: int
    admins: int


class AdminTour(Tour):
    file_count: int
    scan_points: int
    models: int
    failed_files: int
    size_bytes: int


class AdminUser(BaseModel):
    id: int
    email: str  # plain str: older accounts may predate email validation
    role: Literal["admin", "viewer"]
    created_at: datetime
    can_log_in: bool


class RoleUpdate(BaseModel):
    role: Literal["admin", "viewer"]


class ActivityEntry(BaseModel):
    id: int
    action: Literal["create", "update", "delete"]
    tour_id: int
    tour_title: str | None  # None once the tour has been deleted
    tour_hospital: str | None
    user_email: str
    created_at: datetime
