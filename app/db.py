
import os
import psycopg
from psycopg.rows import dict_row
from fastapi import HTTPException
from app.models import TourCreate, Tour

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/tourvault"
)


def get_db_connection():
    return psycopg.connect(
        DATABASE_URL,
        row_factory=dict_row
    )



def get_all_tours(
    limit: int = 10,
    offset: int = 0,
    hospital: str | None = None
):
    sql = """
        SELECT id, hospital, title, status, created_at
        FROM tours
    """

    params = []

    if hospital is not None:
        sql += " WHERE hospital = %s"
        params.append(hospital)

    sql += " ORDER BY id LIMIT %s OFFSET %s"
    params.extend([limit, offset])

    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql, params)
            tours = cursor.fetchall()

            return [Tour(**tour) for tour in tours]






def get_tour(tour_id: int):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, hospital, title, status, created_at
                FROM tours
                WHERE id = %s
                """,
                (tour_id,)
            )
            tour = cursor.fetchone()

            if tour is None:
                raise HTTPException(
                    status_code=404,
                    detail="Tour not found"
                )

            return tour


def create_tour(tour: TourCreate):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO tours (hospital, title, status)
                VALUES (%s, %s, %s)
                RETURNING *
                """,
                (tour.hospital, tour.title, tour.status)
            )
            new_tour = cursor.fetchone()

            if new_tour is None:
                raise HTTPException(
                    status_code=500,
                    detail="Tour could not be created"
                )

            return new_tour


def update_tour(tour_id: int, tour: TourCreate):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE tours
                SET hospital = %s,
                    title = %s,
                    status = %s
                WHERE id = %s
                RETURNING *
                """,
                (tour.hospital, tour.title, tour.status, tour_id)
            )
            updated_tour = cursor.fetchone()

            if updated_tour is None:
                raise HTTPException(
                    status_code=404,
                    detail="Tour not found"
                )

            return updated_tour



def delete_tour(tour_id: int):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM tours
                WHERE id = %s
                RETURNING *
                """,
                (tour_id,)
            )
            deleted_tour = cursor.fetchone()

            if deleted_tour is None:
                raise HTTPException(
                    status_code=404,
                    detail="Tour not found"
                )

            return deleted_tour


def create_user(email: str, password_hash: str, role: str = "viewer"):
    # Receives an already-hashed password: hashing is auth's job, storing is db's job.
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, password_hash, role)
                VALUES (%s, %s, %s)
                RETURNING id, email, role, created_at
                """,
                (email, password_hash, role)
            )

            user = cursor.fetchone()
            return user


def get_user_by_email(email: str):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, email, password_hash, role, created_at
                FROM users
                WHERE email = %s
                """,
                (email,)
            )

            user = cursor.fetchone()

            if user is None:
                return None

            return user


def get_user_by_id(user_id: int):
    # Used to load the logged-in user from the token. No password_hash on purpose.
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, email, role, created_at
                FROM users
                WHERE id = %s
                """,
                (user_id,)
            )
            return cursor.fetchone()




def log_action(user_id: int, action: str, tour_id: int | None = None):
    sql = """
        INSERT INTO audit_log (user_id, action, tour_id)
        VALUES (%s, %s, %s)
    """

    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql, (user_id, action, tour_id))


# ---------- Assets (file metadata; the files themselves live in S3 storage) ----------

def create_asset(tour_id: int, filename: str, object_key: str,
                 content_type: str | None, size_bytes: int, uploaded_by: int):
    with get_db_connection() as conn:
        return conn.execute(
            """
            INSERT INTO assets (tour_id, filename, object_key, content_type, size_bytes, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, tour_id, filename, object_key, content_type, size_bytes, status, vertex_count, error, created_at
            """,
            (tour_id, filename, object_key, content_type, size_bytes, uploaded_by),
        ).fetchone()


def list_assets(tour_id: int):
    with get_db_connection() as conn:
        return conn.execute(
            """
            SELECT id, tour_id, filename, object_key, content_type, size_bytes, status, vertex_count, error, created_at
            FROM assets
            WHERE tour_id = %s
            ORDER BY id
            """,
            (tour_id,),
        ).fetchall()


def get_asset(asset_id: int):
    with get_db_connection() as conn:
        return conn.execute(
            """
            SELECT id, tour_id, filename, object_key, content_type, size_bytes, status, vertex_count, error, created_at
            FROM assets
            WHERE id = %s
            """,
            (asset_id,),
        ).fetchone()


def update_asset_status(asset_id: int, status: str,
                        vertex_count: int | None = None, error: str | None = None):
    """Move an asset through its lifecycle: uploaded -> processing -> ready | failed."""
    with get_db_connection() as conn:
        conn.execute(
            """
            UPDATE assets
            SET status = %s, vertex_count = %s, error = %s
            WHERE id = %s
            """,
            (status, vertex_count, error, asset_id),
        )
