CREATE TABLE tours (
    
    id SERIAL PRIMARY KEY,
    hospital VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer'
        CHECK (role IN ('admin', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS audit_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    tour_id     INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3D asset files live in S3 storage; this table holds their metadata.
CREATE TABLE IF NOT EXISTS assets (
    id            SERIAL PRIMARY KEY,
    tour_id       INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,              -- original name, for display only
    object_key    TEXT NOT NULL UNIQUE,       -- where the file lives in the bucket
    content_type  TEXT,
    size_bytes    BIGINT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'uploaded'
                  CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
    uploaded_by   INTEGER REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
