-- Kritical SCX — CHUNK STORE schema (.5231). External storage for editing massive files across
-- synthetic context: a file is split into semantic chunks; the model ever only holds the FOCUS
-- chunk(s) in full + a synthetic MAP (per-chunk summary) of the rest; the full text lives here.
--
-- SQLite (node:sqlite / DatabaseSync) — the shippable default:

CREATE TABLE IF NOT EXISTS files (
  file        TEXT PRIMARY KEY,   -- repo-relative path
  lang        TEXT,
  loc         INTEGER,            -- total line count
  sha         TEXT,               -- SHA-256 of the whole current content
  n_chunks    INTEGER,
  synopsis    TEXT,               -- optional SCX one-paragraph file overview
  mined_utc   TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  file        TEXT NOT NULL,
  idx         INTEGER NOT NULL,   -- 0-based order in the file
  start_line  INTEGER NOT NULL,   -- 1-based inclusive
  end_line    INTEGER NOT NULL,   -- 1-based inclusive
  sha         TEXT,               -- SHA-256 of this chunk's content
  symbols     TEXT,               -- comma-separated top-level symbols defined in this chunk
  content     TEXT NOT NULL,      -- the raw chunk text (external storage — NOT in the model window)
  summary     TEXT,               -- SCX-generated synthetic summary (the "synthetic context" for the map)
  PRIMARY KEY (file, idx)
);
CREATE INDEX IF NOT EXISTS ix_chunks_file ON chunks(file);
CREATE INDEX IF NOT EXISTS ix_chunks_sym  ON chunks(symbols);

-- Empirical model routing: capability is measured, not assumed from marketing metadata.
-- The mux uses latest score rows to order candidate models for a task type.
CREATE TABLE IF NOT EXISTS model_eval_results (
    eval_id             TEXT PRIMARY KEY,
    model_id            TEXT NOT NULL,
    benchmark_name      TEXT NOT NULL,
    task_type           TEXT NOT NULL,
    score               REAL NOT NULL,
    latency_ms          INTEGER,
    cost_estimate       REAL,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_model_eval_route
ON model_eval_results(model_id, task_type, benchmark_name, created_at);

-- .5231 6502 content-addressing: each UNIQUE chunk body is stored ONCE, keyed by its SHA-256. Chunk rows
-- carry the sha reference and NULL content; reads materialise content via LEFT JOIN blobs ON blobs.sha=chunks.sha.
-- Identical chunks (repeated boilerplate, or unchanged chunks across file versions) cost one blob, not N.
-- codec = per-blob storage tier: 'raw' text, or 'gz' (gzip -> base64) when that is genuinely smaller.
-- Small/incompressible bodies stay raw automatically (base64 inflates ~33%, so gz only wins on compressible
-- code). Reads decode by codec — byte-exact. SQL Server mirror uses VARBINARY + COMPRESS()/DECOMPRESS() and
-- needs no base64 (COMPRESS already yields gzip bytes), so its codec is implicit.
CREATE TABLE IF NOT EXISTS blobs (
  sha      TEXT PRIMARY KEY,   -- SHA-256 of the content
  codec    TEXT,               -- 'raw' | 'gz'
  content  TEXT                -- raw text, or base64(gzip(content)) when codec='gz'
);

-- SQL Server (dbo.*) equivalent — the server-side warehouse (KriticalSCXCodeStore):
--   IF OBJECT_ID('dbo.ChunkFile') IS NULL CREATE TABLE dbo.ChunkFile(
--     file NVARCHAR(500) PRIMARY KEY, lang VARCHAR(12), loc INT, sha CHAR(64),
--     n_chunks INT, synopsis NVARCHAR(MAX), mined_utc DATETIME2 DEFAULT SYSUTCDATETIME());
--   IF OBJECT_ID('dbo.Chunk') IS NULL CREATE TABLE dbo.Chunk(
--     file NVARCHAR(500), idx INT, start_line INT, end_line INT, sha CHAR(64),
--     symbols NVARCHAR(400), content_gz VARBINARY(MAX), summary NVARCHAR(MAX),
--     CONSTRAINT PK_Chunk PRIMARY KEY(file, idx));
--   -- content stored gzip-compressed via COMPRESS(); DECOMPRESS() to read (byte-exact, per .5231 lens fix).
--   IF OBJECT_ID('dbo.ModelEvalResults') IS NULL CREATE TABLE dbo.ModelEvalResults(
--     eval_id NVARCHAR(80) PRIMARY KEY,
--     model_id NVARCHAR(160) NOT NULL,
--     benchmark_name NVARCHAR(160) NOT NULL,
--     task_type NVARCHAR(120) NOT NULL,
--     score FLOAT NOT NULL,
--     latency_ms INT NULL,
--     cost_estimate FLOAT NULL,
--     notes NVARCHAR(MAX) NULL,
--     created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
