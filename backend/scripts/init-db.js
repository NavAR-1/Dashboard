require('../src/config/env');
const { pool } = require('../src/infrastructure/database/postgres');
const { hashPassword } = require('../src/domain/password');
const statements = [
  'CREATE EXTENSION IF NOT EXISTS postgis',
  "CREATE TABLE IF NOT EXISTS admin_users (id SERIAL PRIMARY KEY, full_name VARCHAR(255), email VARCHAR(255) UNIQUE NOT NULL, password_hash TEXT NOT NULL, role VARCHAR(80) DEFAULT 'admin', is_active BOOLEAN DEFAULT TRUE, last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS roles (id SERIAL PRIMARY KEY, role_key VARCHAR(120) UNIQUE NOT NULL, name VARCHAR(160) NOT NULL, description TEXT DEFAULT '', is_system BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS permission_modules (id SERIAL PRIMARY KEY, module_key VARCHAR(120) UNIQUE NOT NULL, name VARCHAR(160) NOT NULL, description TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS permissions (id SERIAL PRIMARY KEY, module_id INTEGER NOT NULL REFERENCES permission_modules(id) ON DELETE CASCADE, action_key VARCHAR(120) NOT NULL, permission_key VARCHAR(240) UNIQUE NOT NULL, name VARCHAR(160) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(module_id, action_key))",
  "CREATE TABLE IF NOT EXISTS role_permissions (role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, PRIMARY KEY(role_id, permission_id))",
  "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id)",
  "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
  'CREATE TABLE IF NOT EXISTS buildings (id SERIAL PRIMARY KEY, name VARCHAR(255), description TEXT, location GEOGRAPHY(Point, 4326), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())',
  "ALTER TABLE buildings ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'active'",
  'CREATE TABLE IF NOT EXISTS graph_nodes (id SERIAL PRIMARY KEY, node_name VARCHAR(255), latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, location GEOGRAPHY(Point, 4326), floor_label VARCHAR(80), node_type VARCHAR(80), is_published BOOLEAN DEFAULT TRUE, is_staff_only BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS graph_edges (id SERIAL PRIMARY KEY, start_node INTEGER REFERENCES graph_nodes(id), end_node INTEGER REFERENCES graph_nodes(id), distance FLOAT, is_accessible BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS qr_anchors (id SERIAL PRIMARY KEY, marker_name VARCHAR(255), latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, location GEOGRAPHY(Point, 4326), model_path TEXT, linked_node INTEGER REFERENCES graph_nodes(id), status VARCHAR(40) DEFAULT \'active\', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())',
  "CREATE TABLE IF NOT EXISTS navigation_sessions (id SERIAL PRIMARY KEY, session_scope VARCHAR(20) DEFAULT 'inside' CHECK (session_scope IN ('inside','outside')), qr_id VARCHAR(120), destination TEXT, session_status VARCHAR(40), visited_node_ids JSONB DEFAULT '[]'::jsonb, session_id TEXT, client_created_at TIMESTAMPTZ DEFAULT NOW())",
  'CREATE TABLE IF NOT EXISTS visit_series (id SERIAL PRIMARY KEY, day DATE UNIQUE NOT NULL, route_requests INTEGER DEFAULT 0, successful_routes INTEGER DEFAULT 0)',
  'ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE',
  'ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS is_staff_only BOOLEAN DEFAULT FALSE',
  'ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION',
  'ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION',
  'ALTER TABLE qr_anchors ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION',
  'ALTER TABLE qr_anchors ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION',
  "ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS session_scope VARCHAR(20) DEFAULT 'inside'",
  "ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS qr_id VARCHAR(120)",
  "ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS session_status VARCHAR(40)",
  "ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'completed'",
  "ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS visited_node_ids JSONB DEFAULT '[]'::jsonb",
  "ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS session_id TEXT",
  "ALTER TABLE navigation_sessions ADD COLUMN IF NOT EXISTS destination TEXT",
  "DO $$ DECLARE fk_name text; BEGIN FOR fk_name IN SELECT con.conname FROM pg_constraint con JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey) WHERE con.conrelid = 'navigation_sessions'::regclass AND con.contype = 'f' AND att.attname = 'destination' LOOP EXECUTE format('ALTER TABLE navigation_sessions DROP CONSTRAINT %I', fk_name); END LOOP; END $$",
  "ALTER TABLE navigation_sessions ALTER COLUMN destination TYPE TEXT USING destination::text",
  "UPDATE navigation_sessions SET session_scope = 'inside' WHERE session_scope IS NULL",
  "ALTER TABLE navigation_sessions DROP CONSTRAINT IF EXISTS navigation_sessions_status_check",
  "ALTER TABLE navigation_sessions DROP CONSTRAINT IF EXISTS navigation_sessions_session_status_check",
  "UPDATE navigation_sessions SET session_status = CASE WHEN status IN ('cancelled','canceled','not_completed') THEN 'cancelled' WHEN status = 'completed' THEN 'completed' ELSE session_status END WHERE session_status IS NULL",
  "DO $$ BEGIN ALTER TABLE navigation_sessions ADD CONSTRAINT navigation_sessions_session_scope_check CHECK (session_scope IN ('inside','outside')); EXCEPTION WHEN duplicate_object THEN NULL; END $$",
  "DO $$ BEGIN ALTER TABLE navigation_sessions ADD CONSTRAINT navigation_sessions_session_status_check CHECK (session_status IS NULL OR session_status IN ('completed','cancelled')); EXCEPTION WHEN duplicate_object THEN NULL; END $$",
  'CREATE TABLE IF NOT EXISTS qr_scans (id SERIAL PRIMARY KEY, qr_code VARCHAR(120), device_id VARCHAR(120), scan_time TIMESTAMPTZ DEFAULT NOW(), resolved_node_id INTEGER REFERENCES graph_nodes(id) ON DELETE SET NULL)',
  'CREATE TABLE IF NOT EXISTS poi_categories (id SERIAL PRIMARY KEY, name VARCHAR(120) UNIQUE NOT NULL, key VARCHAR(120) UNIQUE NOT NULL, description TEXT, is_published BOOLEAN DEFAULT TRUE)',
  'CREATE TABLE IF NOT EXISTS access_logs (id SERIAL PRIMARY KEY, actor VARCHAR(255), action VARCHAR(255), target VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW())',
  'ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS role VARCHAR(120)',
  'CREATE TABLE IF NOT EXISTS feedback (id SERIAL PRIMARY KEY, type VARCHAR(80), message TEXT, rating INTEGER, session_id INTEGER REFERENCES navigation_sessions(id) ON DELETE SET NULL, node_id INTEGER REFERENCES graph_nodes(id) ON DELETE SET NULL, status VARCHAR(80) DEFAULT \'open\', created_at TIMESTAMPTZ DEFAULT NOW())',
  "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS chips JSONB DEFAULT '[]'::jsonb",
  "CREATE TABLE IF NOT EXISTS source_records (id SERIAL PRIMARY KEY, source VARCHAR(80) NOT NULL, record_type VARCHAR(120) NOT NULL, dedupe_key VARCHAR(255) NOT NULL, external_id VARCHAR(255), name TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, first_seen_at TIMESTAMPTZ DEFAULT NOW(), last_seen_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(source, record_type, dedupe_key))",
  "CREATE INDEX IF NOT EXISTS idx_source_records_source_type ON source_records(source, record_type)",
  "CREATE INDEX IF NOT EXISTS idx_source_records_name ON source_records(name)",
  "CREATE TABLE IF NOT EXISTS sync_logs (id SERIAL PRIMARY KEY, source VARCHAR(80) NOT NULL, operation VARCHAR(120) NOT NULL, record_type VARCHAR(120), dedupe_key VARCHAR(255), action VARCHAR(40), details_json JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS idx_sync_logs_source_created ON sync_logs(source, created_at DESC)",
  'CREATE TABLE IF NOT EXISTS system_settings (id SERIAL PRIMARY KEY, category VARCHAR(80) UNIQUE NOT NULL, settings_json JSONB NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_buildings_location ON buildings USING GIST(location)',
  'CREATE INDEX IF NOT EXISTS idx_graph_nodes_location ON graph_nodes USING GIST(location)',
  'CREATE INDEX IF NOT EXISTS idx_qr_anchors_location ON qr_anchors USING GIST(location)',
  'CREATE INDEX IF NOT EXISTS idx_graph_edges_start_end ON graph_edges(start_node, end_node)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON navigation_sessions(client_created_at)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_scope ON navigation_sessions(session_scope)',
  "CREATE UNIQUE INDEX IF NOT EXISTS navigation_sessions_session_id_idx ON navigation_sessions (session_id) WHERE session_id IS NOT NULL",
  "INSERT INTO roles (role_key, name, description, is_system) VALUES ('admin','Admin','Full platform access',TRUE),('facility_manager','Facility Manager','Manages facilities, maps, QR anchors, and routes',TRUE),('analyst','Analyst','Reads dashboard and analytics data',TRUE) ON CONFLICT (role_key) DO NOTHING",
  "INSERT INTO permission_modules (module_key, name, description) VALUES ('dashboard','Dashboard','Overview metrics and live analytics'),('facilities','Facilities','Buildings and facility records'),('maps','Maps & Navigation','Navigation nodes, pathfinding, and map layers'),('qr_anchors','QR Anchors','AR marker and QR anchor records'),('routes','Routes','Route graph and usage records'),('analytics','Analytics','Performance and usage analysis'),('feedback','Feedback','Mobile feedback, ratings, and route issue reports'),('settings','Settings','System settings and maintenance'),('access_control','Access Control','Roles, users, modules, and permissions') ON CONFLICT (module_key) DO NOTHING",
  "INSERT INTO permissions (module_id, action_key, permission_key, name) SELECT m.id, a.action_key, m.module_key || '.' || a.action_key, a.name FROM permission_modules m CROSS JOIN (VALUES ('read','Read'),('create','Create'),('update','Edit'),('delete','Delete'),('status','Change Status')) AS a(action_key, name) WHERE m.module_key IN ('facilities') ON CONFLICT (permission_key) DO NOTHING",
  "INSERT INTO permissions (module_id, action_key, permission_key, name) SELECT m.id, a.action_key, m.module_key || '.' || a.action_key, a.name FROM permission_modules m CROSS JOIN (VALUES ('read','Read'),('create','Create'),('update','Edit'),('delete','Delete')) AS a(action_key, name) WHERE m.module_key IN ('maps','qr_anchors','routes','access_control') ON CONFLICT (permission_key) DO NOTHING",
  "INSERT INTO permissions (module_id, action_key, permission_key, name) SELECT m.id, a.action_key, m.module_key || '.' || a.action_key, a.name FROM permission_modules m CROSS JOIN (VALUES ('read','Read'),('update','Edit')) AS a(action_key, name) WHERE m.module_key IN ('dashboard','analytics','feedback','settings') ON CONFLICT (permission_key) DO NOTHING",
  "INSERT INTO permissions (module_id, action_key, permission_key, name) SELECT m.id, 'assign', 'access_control.assign', 'Assign Roles' FROM permission_modules m WHERE m.module_key='access_control' ON CONFLICT (permission_key) DO NOTHING",
  "INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.role_key='admin' ON CONFLICT DO NOTHING",
  "INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r JOIN permissions p ON p.permission_key IN ('dashboard.read','facilities.read','facilities.create','facilities.update','facilities.status','maps.read','maps.create','maps.update','qr_anchors.read','qr_anchors.create','qr_anchors.update','routes.read','routes.create','routes.update','analytics.read','feedback.read','feedback.update','settings.read','settings.update') WHERE r.role_key='facility_manager' ON CONFLICT DO NOTHING",
  "INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r JOIN permissions p ON p.permission_key IN ('dashboard.read','facilities.read','maps.read','qr_anchors.read','routes.read','analytics.read','feedback.read') WHERE r.role_key='analyst' ON CONFLICT DO NOTHING",
  "UPDATE admin_users au SET role_id = r.id FROM roles r WHERE au.role_id IS NULL AND r.role_key = COALESCE(NULLIF(au.role,''),'admin')",
  "UPDATE admin_users au SET role_id = r.id FROM roles r WHERE au.role_id IS NULL AND r.role_key = 'admin'"
];
async function main(){
  for(const [index, statement] of statements.entries()){
    try{
      await pool.query(statement);
    }catch(error){
      console.error(`[db:init] failed statement ${index + 1}: ${statement.slice(0, 180)}`);
      throw error;
    }
  }
  await ensureDemoAccount('Admin User', 'admin@navar.local', 'Admin@12345', 'admin');
  await ensureDemoAccount('Facility Manager', 'facility@navar.local', 'Facility@12345', 'facility_manager');
  await ensureDemoAccount('Analytics Viewer', 'analyst@navar.local', 'Analyst@12345', 'analyst');
  console.log('Database schema is ready.');
}
async function ensureDemoAccount(fullName, email, password, roleKey){
  await pool.query(`
    INSERT INTO admin_users (full_name, email, password_hash, role, role_id)
    SELECT $1, $2, $3, r.role_key, r.id
    FROM roles r
    WHERE r.role_key = $4
    ON CONFLICT (email) DO NOTHING
  `, [fullName, email, hashPassword(password), roleKey]);
}
main().catch(error=>{ console.error(error); process.exitCode = 1; }).finally(()=>pool.end());

