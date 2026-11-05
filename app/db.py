
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
                (email.strip().lower(), password_hash, role)
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
                WHERE lower(email) = lower(%s)
                """,
                (email.strip(),)
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

ASSET_COLUMNS = (
    "id, tour_id, filename, object_key, content_type, size_bytes, status, vertex_count, error, "
    "kind, face_keys, face_size, position, heading, created_at"
)


def ensure_schema() -> None:
    """Add columns that newer code needs to an older database. Each statement
    is idempotent (IF NOT EXISTS), so this is safe on every startup. New
    databases already get these columns from schema.sql."""
    with get_db_connection() as conn:
        conn.execute(
            """
            ALTER TABLE assets
                ADD COLUMN IF NOT EXISTS kind      TEXT,
                ADD COLUMN IF NOT EXISTS face_keys TEXT[],
                ADD COLUMN IF NOT EXISTS face_size INTEGER,
                ADD COLUMN IF NOT EXISTS position  DOUBLE PRECISION[],
                ADD COLUMN IF NOT EXISTS heading   DOUBLE PRECISION
            """
        )

def create_asset(tour_id: int, filename: str, object_key: str,
                 content_type: str | None, size_bytes: int, uploaded_by: int):
    with get_db_connection() as conn:
        return conn.execute(
            f"""
            INSERT INTO assets (tour_id, filename, object_key, content_type, size_bytes, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING {ASSET_COLUMNS}
            """,
            (tour_id, filename, object_key, content_type, size_bytes, uploaded_by),
        ).fetchone()


def list_assets(tour_id: int):
    with get_db_connection() as conn:
        return conn.execute(
            f"""
            SELECT {ASSET_COLUMNS}
            FROM assets
            WHERE tour_id = %s
            ORDER BY id
            """,
            (tour_id,),
        ).fetchall()


def get_asset(asset_id: int):
    with get_db_connection() as conn:
        return conn.execute(
            f"""
            SELECT {ASSET_COLUMNS}
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


def finish_model(asset_id: int, vertex_count: int) -> None:
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE assets SET status = 'ready', kind = 'model', vertex_count = %s, error = NULL WHERE id = %s",
            (vertex_count, asset_id),
        )


def finish_panorama(asset_id: int, face_keys: list[str], face_size: int,
                    position: list[float] | None = None, heading: float | None = None) -> None:
    """Mark a cube map ready. face_keys must be in panorama.FACE_ORDER.
    A placement from the zip replaces the stored one; without one, a placement
    an admin set earlier is kept (so reprocessing does not lose it)."""
    with get_db_connection() as conn:
        conn.execute(
            """
            UPDATE assets
            SET status = 'ready', kind = 'panorama', face_keys = %s, face_size = %s,
                position = COALESCE(%s, position), heading = COALESCE(%s, heading),
                vertex_count = NULL, error = NULL
            WHERE id = %s
            """,
            (face_keys, face_size, position, heading, asset_id),
        )


def set_placement(asset_id: int, position: list[float] | None, heading: float | None):
    with get_db_connection() as conn:
        return conn.execute(
            f"UPDATE assets SET position = %s, heading = %s WHERE id = %s RETURNING {ASSET_COLUMNS}",
            (position, heading, asset_id),
        ).fetchone()


def list_unfinished_asset_ids() -> list[int]:
    """Assets left in 'uploaded' or 'processing', e.g. because the server
    restarted while a background job was running. Used to resume them."""
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM assets WHERE status IN ('uploaded', 'processing') ORDER BY id"
        ).fetchall()
        return [row["id"] for row in rows]


def claim_asset_for_processing(asset_id: int) -> bool:
    """Atomically move an asset to 'processing'. Returns False if another job
    already holds it or it is finished, so the same file is never processed twice."""
    with get_db_connection() as conn:
        row = conn.execute(
            """
            UPDATE assets
            SET status = 'processing', error = NULL
            WHERE id = %s AND status = 'uploaded'
            RETURNING id
            """,
            (asset_id,),
        ).fetchone()
        return row is not None


def reset_asset_for_reprocessing(asset_id: int) -> None:
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE assets SET status = 'uploaded', vertex_count = NULL, error = NULL WHERE id = %s",
            (asset_id,),
        )


def delete_asset(asset_id: int):
    with get_db_connection() as conn:
        return conn.execute(
            "DELETE FROM assets WHERE id = %s RETURNING id, object_key, face_keys",
            (asset_id,),
        ).fetchone()


# ---------- Admin portal ----------

def admin_stats():
    with get_db_connection() as conn:
        return conn.execute(
            """
            SELECT
                (SELECT count(*) FROM tours)                                              AS tours,
                (SELECT count(*) FROM tours WHERE status = 'published')                   AS published_tours,
                (SELECT count(*) FROM assets)                                             AS files,
                (SELECT count(*) FROM assets WHERE kind = 'panorama')                     AS scan_points,
                (SELECT count(*) FROM assets WHERE kind = 'model')                        AS models,
                (SELECT count(*) FROM assets WHERE status IN ('uploaded', 'processing'))  AS processing_files,
                (SELECT count(*) FROM assets WHERE status = 'failed')                     AS failed_files,
                (SELECT coalesce(sum(size_bytes), 0) FROM assets)                         AS storage_bytes,
                (SELECT count(*) FROM users)                                              AS users,
                (SELECT count(*) FROM users WHERE role = 'admin')                         AS admins
            """
        ).fetchone()


def admin_tours():
    """Every tour with counts of its files, for the admin tours table."""
    with get_db_connection() as conn:
        return conn.execute(
            """
            SELECT t.id, t.hospital, t.title, t.status, t.version, t.created_at,
                   count(a.id)                                    AS file_count,
                   count(a.id) FILTER (WHERE a.kind = 'panorama') AS scan_points,
                   count(a.id) FILTER (WHERE a.kind = 'model')    AS models,
                   count(a.id) FILTER (WHERE a.status = 'failed') AS failed_files,
                   coalesce(sum(a.size_bytes), 0)                 AS size_bytes
            FROM tours t
            LEFT JOIN assets a ON a.tour_id = t.id
            GROUP BY t.id
            ORDER BY t.id
            """
        ).fetchall()


def list_users():
    # can_log_in is false for old accounts saved without a password hash.
    with get_db_connection() as conn:
        return conn.execute(
            "SELECT id, email, role, created_at, password_hash <> '' AS can_log_in FROM users ORDER BY id"
        ).fetchall()


class LastAdminError(Exception):
    """The change would leave nobody able to administer the system."""


def _lock_users(cursor, user_id: int):
    # Lock the table against concurrent role changes, so two admins demoting
    # each other at the same moment cannot both succeed and leave no admin.
    cursor.execute("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE")
    cursor.execute("SELECT id, role FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _admin_count(cursor) -> int:
    cursor.execute("SELECT count(*) AS n FROM users WHERE role = 'admin'")
    return cursor.fetchone()["n"]


def set_user_role(user_id: int, role: str):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            user = _lock_users(cursor, user_id)
            if user["role"] == "admin" and role != "admin" and _admin_count(cursor) <= 1:
                raise LastAdminError()
            cursor.execute(
                """
                UPDATE users SET role = %s WHERE id = %s
                RETURNING id, email, role, created_at, password_hash <> '' AS can_log_in
                """,
                (role, user_id),
            )
            return cursor.fetchone()


def delete_user(user_id: int):
    """Raises psycopg.errors.ForeignKeyViolation if the user has activity on record."""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            user = _lock_users(cursor, user_id)
            if user["role"] == "admin" and _admin_count(cursor) <= 1:
                raise LastAdminError()
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))


def list_activity(limit: int = 50):
    # LEFT JOIN: a deleted tour keeps its audit rows, just without a title.
    with get_db_connection() as conn:
        return conn.execute(
            """
            SELECT l.id, l.action, l.tour_id, t.title AS tour_title, t.hospital AS tour_hospital,
                   u.email AS user_email, l.created_at
            FROM audit_log l
            JOIN users u ON u.id = l.user_id
            LEFT JOIN tours t ON t.id = l.tour_id
            ORDER BY l.id DESC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
