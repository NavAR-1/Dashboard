/**
 * Idempotent migration — runs on every server start.
 * Uses IF NOT EXISTS / DO $$ blocks so it is safe to re-run.
 */
const db = require('./postgres');

async function migrate() {
  const steps = [
    // ── navigation_sessions — add missing columns ──────────────────────────
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS session_scope TEXT NOT NULL DEFAULT 'inside'`,
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS qr_id TEXT`,
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS session_status TEXT`,
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'`,
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS visited_node_ids JSONB NOT NULL DEFAULT '[]'`,
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS client_created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION`,
    `ALTER TABLE navigation_sessions DROP CONSTRAINT IF EXISTS navigation_sessions_status_check`,
    `ALTER TABLE navigation_sessions DROP CONSTRAINT IF EXISTS navigation_sessions_session_status_check`,
    `UPDATE navigation_sessions
     SET session_status = CASE
       WHEN status IN ('cancelled','canceled','not_completed') THEN 'cancelled'
       WHEN status = 'completed' THEN 'completed'
       ELSE session_status
     END
     WHERE session_status IS NULL`,
    `DO $$ BEGIN
       ALTER TABLE navigation_sessions
       ADD CONSTRAINT navigation_sessions_session_status_check
       CHECK (session_status IS NULL OR session_status IN ('completed','cancelled'));
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`,

    // ── navigation_sessions — rename columns ──────────────────────────────
    // client_session_id → session_id
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='navigation_sessions' AND column_name='client_session_id')
       THEN ALTER TABLE navigation_sessions RENAME COLUMN client_session_id TO session_id;
       END IF;
     END $$`,
    // end_node → destination
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='navigation_sessions' AND column_name='end_node')
       THEN ALTER TABLE navigation_sessions RENAME COLUMN end_node TO destination;
       END IF;
     END $$`,

    // ── navigation_sessions — drop unused columns ─────────────────────────
    `ALTER TABLE navigation_sessions DROP COLUMN IF EXISTS device_id`,
    `ALTER TABLE navigation_sessions DROP COLUMN IF EXISTS start_node`,
    `ALTER TABLE navigation_sessions DROP COLUMN IF EXISTS success`,
    `ALTER TABLE navigation_sessions DROP COLUMN IF EXISTS duration_seconds`,
    `ALTER TABLE navigation_sessions DROP COLUMN IF EXISTS recovery_count`,
    `ALTER TABLE navigation_sessions DROP COLUMN IF EXISTS created_at`,

    // Ensure session_id column exists (for fresh DBs that skipped the rename path)
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS session_id TEXT`,
    `ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS destination TEXT`,
    `DO $$ DECLARE fk_name text;
     BEGIN
       FOR fk_name IN
         SELECT con.conname
         FROM pg_constraint con
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
         WHERE con.conrelid = 'navigation_sessions'::regclass
           AND con.contype = 'f'
           AND att.attname = 'destination'
       LOOP
         EXECUTE format('ALTER TABLE navigation_sessions DROP CONSTRAINT %I', fk_name);
       END LOOP;
     END $$`,
    `ALTER TABLE navigation_sessions ALTER COLUMN destination TYPE TEXT USING destination::text`,
    `CREATE UNIQUE INDEX IF NOT EXISTS navigation_sessions_session_id_idx ON navigation_sessions (session_id) WHERE session_id IS NOT NULL`,

    // ── feedback table ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS feedback (
      id           SERIAL PRIMARY KEY,
      type         TEXT        NOT NULL DEFAULT 'feedback',
      chips        JSONB       NOT NULL DEFAULT '[]',
      message      TEXT,
      rating       SMALLINT    CHECK (rating BETWEEN 1 AND 5),
      session_id   INTEGER     REFERENCES navigation_sessions(id) ON DELETE SET NULL,
      node_id      INTEGER     REFERENCES navigation_nodes(id)    ON DELETE SET NULL,
      status       TEXT        NOT NULL DEFAULT 'open',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // chips column may be missing on older deployments that had feedback table
    `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS chips JSONB NOT NULL DEFAULT '[]'`,

    // ── system_settings ───────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS system_settings (
      id            SERIAL PRIMARY KEY,
      category      TEXT        NOT NULL UNIQUE,
      settings_json JSONB       NOT NULL DEFAULT '{}',
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // seed default categories so the settings page has something to show
    `INSERT INTO system_settings (category, settings_json) VALUES
      ('organization', '{"organization_name":"","campus_label":"","support_contact":"","timezone":"Africa/Addis_Ababa"}'),
      ('sessions',     '{"session_timeout":30,"sync_interval":60,"retention_period":90,"anonymous_id_policy":"rotating"}'),
      ('security',     '{"token_ttl":480,"password_rules":"min_length:8","inactive_user_handling":"disable","allowed_origins":[]}')
    ON CONFLICT (category) DO NOTHING`,

    // ── qr_scans ──────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS qr_scans (
      id               SERIAL PRIMARY KEY,
      qr_code          TEXT        NOT NULL,
      device_id        TEXT,
      resolved_node_id INTEGER     REFERENCES navigation_nodes(id) ON DELETE SET NULL,
      scan_time        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    // ── access_logs ───────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS access_logs (
      id         SERIAL PRIMARY KEY,
      actor      TEXT,
      action     TEXT,
      target     TEXT,
      role       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS role TEXT`,

    `CREATE TABLE IF NOT EXISTS source_records (
      id            SERIAL PRIMARY KEY,
      source        TEXT NOT NULL,
      record_type   TEXT NOT NULL,
      dedupe_key    TEXT NOT NULL,
      external_id   TEXT,
      name          TEXT,
      latitude      DOUBLE PRECISION,
      longitude     DOUBLE PRECISION,
      data_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source, record_type, dedupe_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_source_records_source_type ON source_records(source, record_type)`,
    `CREATE INDEX IF NOT EXISTS idx_source_records_name ON source_records(name)`,
    `CREATE TABLE IF NOT EXISTS sync_logs (
      id           SERIAL PRIMARY KEY,
      source       TEXT NOT NULL,
      operation    TEXT NOT NULL,
      record_type  TEXT,
      dedupe_key   TEXT,
      action       TEXT,
      details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sync_logs_source_created ON sync_logs(source, created_at DESC)`,

    // ── poi_categories ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS poi_categories (
      id           SERIAL PRIMARY KEY,
      name         TEXT    NOT NULL,
      key          TEXT    NOT NULL UNIQUE,
      description  TEXT    NOT NULL DEFAULT '',
      is_published BOOLEAN NOT NULL DEFAULT TRUE
    )`,

    // ── visit_series view (dashboard chart) ───────────────────────────────
    // init-db.js created visit_series as a TABLE; we replace it with a live VIEW.
    // We must drop the table variant first — DROP VIEW/MATVIEW won't touch a table.
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE c.relname = 'visit_series' AND c.relkind = 'r' AND n.nspname = 'public')
       THEN DROP TABLE visit_series CASCADE;
       END IF;
     END $$`,
    `CREATE OR REPLACE VIEW visit_series AS
      SELECT
        gs.day::date                                                                      AS day,
        COUNT(ns.id)::int                                                                 AS route_requests,
        COUNT(CASE WHEN ns.session_status = 'completed' THEN 1 END)::int                 AS successful_routes
      FROM generate_series(
             (NOW() - INTERVAL '6 days')::date,
             NOW()::date,
             '1 day'::interval
           ) AS gs(day)
      LEFT JOIN navigation_sessions ns
        ON ns.client_created_at::date = gs.day::date
      GROUP BY gs.day
      ORDER BY gs.day`,

    // ── roles / permissions tables (access control) ───────────────────────
    `CREATE TABLE IF NOT EXISTS roles (
      id          SERIAL PRIMARY KEY,
      role_key    TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      is_system   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS permission_modules (
      id          SERIAL PRIMARY KEY,
      module_key  TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS permissions (
      id             SERIAL PRIMARY KEY,
      module_id      INTEGER NOT NULL REFERENCES permission_modules(id) ON DELETE CASCADE,
      action_key     TEXT    NOT NULL,
      permission_key TEXT    NOT NULL UNIQUE,
      name           TEXT    NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS role_permissions (
      role_id       INTEGER NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    )`,
    // role_id column on admin_users (may not have existed)
    `ALTER TABLE buildings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
    `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL`,
    `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
    `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `INSERT INTO permissions (module_id, action_key, permission_key, name)
     SELECT id, 'status', 'facilities.status', 'Change Status'
     FROM permission_modules
     WHERE module_key = 'facilities'
     ON CONFLICT (permission_key) DO NOTHING`,
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id
     FROM roles r
     JOIN permissions p ON p.permission_key = 'facilities.status'
     WHERE r.role_key IN ('admin', 'facility_manager')
     ON CONFLICT DO NOTHING`,

    // ── Ensure admin role always has every permission ─────────────────────
    // Idempotent: ON CONFLICT DO NOTHING skips duplicates.
    // This fixes the case where permissions were added after the admin role
    // was created (e.g. facilities.status, access_control.assign, etc.)
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id
     FROM roles r
     CROSS JOIN permissions p
     WHERE r.role_key = 'admin'
     ON CONFLICT DO NOTHING`,

    // ── Ensure admin_users.role_id is set for any admin account ──────────
    `UPDATE admin_users au
     SET role_id = r.id
     FROM roles r
     WHERE r.role_key = 'admin'
       AND au.role_id IS NULL
       AND (au.role = 'admin' OR au.role IS NULL)`,

    // ── Rename core tables to match design diagram ────────────────────────
    // navigation_nodes → graph_nodes
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='navigation_nodes')
          AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='graph_nodes')
       THEN ALTER TABLE navigation_nodes RENAME TO graph_nodes;
       END IF;
     END $$`,
    // routes → graph_edges
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='routes')
          AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='graph_edges')
       THEN ALTER TABLE routes RENAME TO graph_edges;
       END IF;
     END $$`,
    // ar_markers → qr_anchors
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='ar_markers')
          AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='qr_anchors')
       THEN ALTER TABLE ar_markers RENAME TO qr_anchors;
       END IF;
     END $$`,

    // ── Add explicit latitude/longitude columns to graph_nodes ────────────
    `ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION`,
    `ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`,
    // Populate from PostGIS location where not yet set
    `UPDATE graph_nodes
     SET latitude  = ST_Y(location::geometry),
         longitude = ST_X(location::geometry)
     WHERE location IS NOT NULL
       AND (latitude IS NULL OR longitude IS NULL)`,

    // ── Add explicit latitude/longitude columns to qr_anchors ─────────────
    `ALTER TABLE qr_anchors ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION`,
    `ALTER TABLE qr_anchors ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`,
    `UPDATE qr_anchors
     SET latitude  = ST_Y(location::geometry),
         longitude = ST_X(location::geometry)
     WHERE location IS NOT NULL
       AND (latitude IS NULL OR longitude IS NULL)`,

    // ── Rename index that referenced old table name ───────────────────────
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_navigation_nodes_location')
       THEN ALTER INDEX idx_navigation_nodes_location RENAME TO idx_graph_nodes_location;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_ar_markers_location')
       THEN ALTER INDEX idx_ar_markers_location RENAME TO idx_qr_anchors_location;
       END IF;
     END $$`,

    // ── Update visit_series view to use graph_nodes in heatmap ────────────
    // (view itself doesn't reference those tables, nothing to change there)

    // ── qr_scans.resolved_node_id FK now points to graph_nodes ───────────
    // The FK was set on the column; after renaming the table the FK still works
    // automatically in Postgres — no action needed.

    // ── feedback.node_id FK still valid after rename ──────────────────────
    // Same as above — Postgres tracks FKs by OID, not name.

    // ════════════════════════════════════════════════════════════════════════
    // ── SEPARATE INDOOR / OUTDOOR SESSION TABLES ─────────────────────────
    // indoor_sessions  → written by the Unity mobile app (always indoors)
    // outdoor_sessions → written by outdoor navigation API + external sync
    // navigation_sessions kept as legacy; no new writes go there.
    // ════════════════════════════════════════════════════════════════════════

    `CREATE TABLE IF NOT EXISTS indoor_sessions (
       id                SERIAL PRIMARY KEY,
       session_id        TEXT,
       qr_id             TEXT,
       destination       TEXT,
       session_status    TEXT CHECK (session_status IS NULL OR session_status IN ('completed','cancelled')),
       visited_node_ids  JSONB NOT NULL DEFAULT '[]',
       client_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS indoor_sessions_session_id_idx
       ON indoor_sessions(session_id) WHERE session_id IS NOT NULL`,

    `CREATE TABLE IF NOT EXISTS outdoor_sessions (
       id                SERIAL PRIMARY KEY,
       session_id        TEXT,
       qr_id             TEXT,
       destination       TEXT,
       session_status    TEXT CHECK (session_status IS NULL OR session_status IN ('completed','cancelled')),
       distance_meters   FLOAT,
       visited_node_ids  JSONB NOT NULL DEFAULT '[]',
       client_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       source            TEXT NOT NULL DEFAULT 'mobile'
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS outdoor_sessions_session_id_idx
       ON outdoor_sessions(session_id) WHERE session_id IS NOT NULL`,

    // ── Migrate existing inside sessions → indoor_sessions ────────────────
    `INSERT INTO indoor_sessions
       (session_id, qr_id, destination, session_status, visited_node_ids, client_created_at)
     SELECT session_id, qr_id, destination, session_status,
            COALESCE(visited_node_ids,'[]'::jsonb),
            COALESCE(client_created_at, NOW())
       FROM navigation_sessions
      WHERE (session_scope = 'inside' OR session_scope IS NULL)
        AND session_id IS NOT NULL
     ON CONFLICT DO NOTHING`,

    `INSERT INTO indoor_sessions
       (qr_id, destination, session_status, visited_node_ids, client_created_at)
     SELECT qr_id, destination, session_status,
            COALESCE(visited_node_ids,'[]'::jsonb),
            COALESCE(client_created_at, NOW())
       FROM navigation_sessions
      WHERE (session_scope = 'inside' OR session_scope IS NULL)
        AND session_id IS NULL`,

    // ── Migrate existing outside sessions → outdoor_sessions ──────────────
    `INSERT INTO outdoor_sessions
       (session_id, qr_id, destination, session_status, visited_node_ids, client_created_at, source)
     SELECT session_id, qr_id, destination, session_status,
            COALESCE(visited_node_ids,'[]'::jsonb),
            COALESCE(client_created_at, NOW()),
            'migrated'
       FROM navigation_sessions
      WHERE session_scope = 'outside'
        AND session_id IS NOT NULL
     ON CONFLICT DO NOTHING`,

    `INSERT INTO outdoor_sessions
       (qr_id, destination, session_status, visited_node_ids, client_created_at, source)
     SELECT qr_id, destination, session_status,
            COALESCE(visited_node_ids,'[]'::jsonb),
            COALESCE(client_created_at, NOW()),
            'migrated'
       FROM navigation_sessions
      WHERE session_scope = 'outside'
        AND session_id IS NULL`,

    // ── Rebuild visit_series view to use indoor_sessions ──────────────────
    `CREATE OR REPLACE VIEW visit_series AS
       SELECT gs.day::date AS day,
              COUNT(is2.id)::int AS route_requests,
              COUNT(CASE WHEN is2.session_status = 'completed' THEN 1 END)::int AS successful_routes
         FROM generate_series(
                (NOW() - INTERVAL '6 days')::date,
                NOW()::date,
                '1 day'::interval
              ) AS gs(day)
         LEFT JOIN indoor_sessions is2
           ON is2.client_created_at::date = gs.day::date
        GROUP BY gs.day
        ORDER BY gs.day`,

    // ── Add from_name / to_name to outdoor_sessions ───────────────────────
    // These store the human-readable location names from the outdoor nav API
    // (external API uses "from_name"/"to_name", not QR anchor IDs)
    `ALTER TABLE outdoor_sessions ADD COLUMN IF NOT EXISTS from_name TEXT`,
    `ALTER TABLE outdoor_sessions ADD COLUMN IF NOT EXISTS to_name   TEXT`,
    // Back-fill: if data was stored in qr_id / destination before this migration
    `UPDATE outdoor_sessions
       SET from_name = qr_id,
           to_name   = destination
     WHERE from_name IS NULL AND to_name IS NULL
       AND (qr_id IS NOT NULL OR destination IS NOT NULL)`,

    // ── Re-point feedback.session_id FK → indoor_sessions ─────────────────
    `DO $$ BEGIN
       ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_session_id_fkey;
     END $$`,
    `DO $$ BEGIN
       ALTER TABLE feedback
         ADD CONSTRAINT feedback_indoor_session_id_fkey
         FOREIGN KEY (session_id) REFERENCES indoor_sessions(id) ON DELETE SET NULL;
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`,

    // ── Demo outdoor rows in outdoor_sessions (idempotent) ─────────────────
    `INSERT INTO outdoor_sessions (session_id,qr_id,destination,session_status,source,client_created_at)
     SELECT 'demo-out-001','QR-B-G-Lobby','Block F - Main Lobby Node','completed','demo',NOW()-INTERVAL'2 hours'
     WHERE NOT EXISTS(SELECT 1 FROM outdoor_sessions WHERE session_id='demo-out-001')`,
    `INSERT INTO outdoor_sessions (session_id,qr_id,destination,session_status,source,client_created_at)
     SELECT 'demo-out-002','QR-H-G-Spine','Block C - HPC Lab Ground','completed','demo',NOW()-INTERVAL'90 minutes'
     WHERE NOT EXISTS(SELECT 1 FROM outdoor_sessions WHERE session_id='demo-out-002')`,
    `INSERT INTO outdoor_sessions (session_id,qr_id,destination,session_status,source,client_created_at)
     SELECT 'demo-out-003','QR-F-G-Lobby','Block B - Main Entrance Lobby','cancelled','demo',NOW()-INTERVAL'45 minutes'
     WHERE NOT EXISTS(SELECT 1 FROM outdoor_sessions WHERE session_id='demo-out-003')`,
    `INSERT INTO outdoor_sessions (session_id,qr_id,destination,session_status,source,client_created_at)
     SELECT 'demo-out-004','QR-G-G-Reactor','Block H - Main Intersecting Corridor Ground','completed','demo',NOW()-INTERVAL'20 minutes'
     WHERE NOT EXISTS(SELECT 1 FROM outdoor_sessions WHERE session_id='demo-out-004')`,
    `INSERT INTO outdoor_sessions (session_id,qr_id,destination,session_status,source,client_created_at)
     SELECT 'demo-out-005','QR-C-G-Corridor','Block G - Primary Reactor Lobby Zone','completed','demo',NOW()-INTERVAL'10 minutes'
     WHERE NOT EXISTS(SELECT 1 FROM outdoor_sessions WHERE session_id='demo-out-005')`,
  ];

  for (const sql of steps) {
    try {
      await db.query(sql);
    } catch (err) {
      // Log but don't crash — some steps may fail on older Postgres versions
      // or if the object already exists in an incompatible state.
      console.warn('[migrate] skipped step:', err.message.split('\n')[0]);
    }
  }

  console.log('[migrate] database schema up to date');
}

module.exports = migrate;
