from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Literal




class TourCreate(BaseModel):
    hospital: str
    title: str
    status: str

class Tour(BaseModel):
    id: int
    hospital: str
    title: str
    status: str







class UserCreate(BaseModel):
    # No `role` here on purpose: the client must never choose its own permissions.
    email: EmailStr
    password: str


class UserOut(BaseModel):
    # What the API returns about a user. Never includes the password or its hash.
    id: int
    email: EmailStr
    role: Literal["admin", "viewer"]
    created_at: datetime


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str


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
    created_at: datetime
