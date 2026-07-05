-- ============================================================
-- HARD RULE 27 decision log — SQL Express KriticalBrain
-- Target: .\SQLEXPRESS  Database: KriticalBrain
-- Idempotent — safe to re-run.
-- ============================================================

USE [KriticalBrain];
GO

-- ------------------------------------------------------------
-- Table
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'decision_log' AND SCHEMA_NAME(schema_id) = 'dbo')
BEGIN
    CREATE TABLE dbo.decision_log
    (
        row_pk               BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
        id                   VARCHAR(32)    NOT NULL,
        ts_utc               DATETIME2(3)   NOT NULL,
        side                 VARCHAR(8)     NOT NULL,   -- human | ai
        category             VARCHAR(32)    NOT NULL,   -- prompt / decision / context / direction / response / action / commit
        wave                 VARCHAR(32)    NULL,
        session_id           VARCHAR(128)   NULL,
        content_sha256       CHAR(64)       NOT NULL,
        simhash              CHAR(64)       NOT NULL,   -- binary string 0/1 x 64
        content_len          INT            NOT NULL,
        content_preview_120  NVARCHAR(255)  NULL,
        content              NVARCHAR(MAX)  NOT NULL,
        model                VARCHAR(128)   NULL,
        provider             VARCHAR(64)    NULL,
        source               VARCHAR(64)    NULL,       -- vscode-extension / manual / backfill / scx-code-agent
        dup_of               VARCHAR(32)    NULL,
        dup_hamming          TINYINT        NULL,
        occurrence_count     INT            NOT NULL CONSTRAINT DF_decision_log_occ DEFAULT 1,
        first_seen_utc       DATETIME2(3)   NOT NULL CONSTRAINT DF_decision_log_first DEFAULT SYSUTCDATETIME(),
        last_seen_utc        DATETIME2(3)   NOT NULL CONSTRAINT DF_decision_log_last  DEFAULT SYSUTCDATETIME(),

        CONSTRAINT UQ_decision_log_sha UNIQUE (content_sha256),
        CONSTRAINT CK_decision_log_side CHECK (side IN ('human','ai')),
        CONSTRAINT CK_decision_log_cat  CHECK (category IN
            ('prompt','decision','context','direction','response','action','commit'))
    );
END
GO

-- ------------------------------------------------------------
-- Indexes for common queries
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_decision_log_ts_side' AND object_id = OBJECT_ID('dbo.decision_log'))
    CREATE INDEX IX_decision_log_ts_side ON dbo.decision_log (ts_utc DESC, side);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_decision_log_session' AND object_id = OBJECT_ID('dbo.decision_log'))
    CREATE INDEX IX_decision_log_session ON dbo.decision_log (session_id, ts_utc);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_decision_log_wave' AND object_id = OBJECT_ID('dbo.decision_log'))
    CREATE INDEX IX_decision_log_wave ON dbo.decision_log (wave, ts_utc);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_decision_log_simhash' AND object_id = OBJECT_ID('dbo.decision_log'))
    CREATE INDEX IX_decision_log_simhash ON dbo.decision_log (simhash);
GO

-- ------------------------------------------------------------
-- Full-text catalog + index for content search
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'ft_decision_log')
BEGIN
    CREATE FULLTEXT CATALOG ft_decision_log AS DEFAULT;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.fulltext_indexes
    WHERE object_id = OBJECT_ID('dbo.decision_log')
)
BEGIN
    CREATE FULLTEXT INDEX ON dbo.decision_log (content LANGUAGE 1033)
        KEY INDEX PK__decision__ ON ft_decision_log
        WITH CHANGE_TRACKING AUTO;
END
GO

-- ------------------------------------------------------------
-- Convenience view — most recent per session
-- ------------------------------------------------------------
IF OBJECT_ID('dbo.v_decision_log_recent') IS NOT NULL DROP VIEW dbo.v_decision_log_recent;
GO
CREATE VIEW dbo.v_decision_log_recent AS
SELECT TOP 5000
    row_pk, id, ts_utc, side, category, wave, session_id,
    content_len, content_preview_120,
    model, provider, source, occurrence_count,
    dup_of, dup_hamming
FROM dbo.decision_log
ORDER BY ts_utc DESC;
GO

-- ------------------------------------------------------------
-- Rotation stored proc — mark rows > 90 days as archived
-- (JSONL side handles physical move; SQL marks status)
-- ------------------------------------------------------------
IF OBJECT_ID('dbo.sp_decision_log_mark_archived') IS NOT NULL DROP PROCEDURE dbo.sp_decision_log_mark_archived;
GO
CREATE PROCEDURE dbo.sp_decision_log_mark_archived
    @Days INT = 90
AS
BEGIN
    -- HR23 supersedes: NEVER delete. This proc is a no-op stub for
    -- future JSONL-rotation companion. Physical move handled by
    -- Sync-KriticalDecisionLogToKriticalBrain on the PS side.
    SELECT
        COUNT(*) AS rows_eligible_for_archive,
        MIN(ts_utc) AS oldest,
        MAX(ts_utc) AS newest
    FROM dbo.decision_log
    WHERE ts_utc < DATEADD(DAY, -@Days, SYSUTCDATETIME());
END
GO

PRINT 'decision_log schema ready — table + 4 indexes + full-text + view + rotation proc.';
GO
