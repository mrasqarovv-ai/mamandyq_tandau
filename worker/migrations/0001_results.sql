CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    quiz_title TEXT NOT NULL,
    quiz_version TEXT NOT NULL,
    student_code TEXT NOT NULL,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 5 AND 8),
    status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'submitted')),
    started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    submitted_at INTEGER,
    score INTEGER,
    max_score INTEGER NOT NULL,
    correct_count INTEGER,
    question_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
    attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'retry', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS outbox_pending ON notification_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS attempts_created ON attempts(started_at);

-- The key is a salted SHA-256 hash, never the raw IP address.
CREATE TABLE IF NOT EXISTS rate_limits (
    ip_hash TEXT NOT NULL,
    hour_bucket INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (ip_hash, hour_bucket)
);
