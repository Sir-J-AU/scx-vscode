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

-- .5231 6502 content-addressing: each UNIQUE chunk body is stored ONCE, keyed by its SHA-256. Chunk rows
-- carry the sha reference and NULL content; reads materialise content via LEFT JOIN blobs ON blobs.sha=chunks.sha.
-- Identical chunks (repeated boilerplate, or unchanged chunks across file versions) cost one blob, not N.
CREATE TABLE IF NOT EXISTS blobs (
  sha      TEXT PRIMARY KEY,   -- SHA-256 of the content
  content  TEXT                -- the unique chunk body (SQL Server: VARBINARY via COMPRESS() for gzip tiering)
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
