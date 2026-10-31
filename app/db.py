
import os
import psycopg
from psycopg.rows import dict_row
from fastapi import HTTPException
from app.models import TourCreate, TourUpdate, Tour

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:5434/tourvault"
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
        SELECT id, hospital, title, status, version, created_at
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
                SELECT id, hospital, title, status, version, created_at
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


# Tour changes and their audit rows are written on ONE connection, in ONE
# transaction: the `with conn` block commits only if everything inside succeeds,
# and rolls back both rows if anything raises. So there is never a change
# without its audit record, or an audit record for a change that didn't happen.

def create_tour(tour: TourCreate, user_id: int):
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

            log_action(cursor, user_id, "create", new_tour["id"])
            return new_tour


def update_tour(tour_id: int, tour: TourUpdate, user_id: int):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            # Only matches if nobody changed the tour since the client read it.
            # Check and write happen in one statement, so two admins cannot both pass.
            cursor.execute(
                """
                UPDATE tours
                SET hospital = %s,
                    title = %s,
                    status = %s,
                    version = version + 1
                WHERE id = %s AND version = %s
                RETURNING *
                """,
                (tour.hospital, tour.title, tour.status, tour_id, tour.version)
            )
            updated_tour = cursor.fetchone()

            if updated_tour is None:
                cursor.execute("SELECT 1 FROM tours WHERE id = %s", (tour_id,))
                if cursor.fetchone() is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Tour not found"
                    )
                raise HTTPException(
                    status_code=409,
                    detail="Tour was changed by someone else; reload it and try again"
                )

            log_action(cursor, user_id, "update", tour_id)
            return updated_tour



def delete_tour(tour_id: int, user_id: int):
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

            log_action(cursor, user_id, "delete", tour_id)
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




def log_action(cursor, user_id: int, action: str, tour_id: int | None = None):
    # Takes the caller's cursor instead of opening its own connection, so the
    # audit row joins the caller's transaction.
    cursor.execute(
        """
        INSERT INTO audit_log (user_id, action, tour_id)
        VALUES (%s, %s, %s)
        """,
        (user_id, action, tour_id)
    )


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
