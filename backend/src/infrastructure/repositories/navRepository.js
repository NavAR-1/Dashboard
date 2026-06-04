const db = require('../database/postgres');
async function listBuildings(){
  const result = await db.query('SELECT id, name, description, COALESCE(status, \'active\') AS status, ' + db.pointSelect() + ' FROM buildings ORDER BY id');
  return result.rows;
}
async function createBuilding(input){
  const result = await db.query('INSERT INTO buildings (name, description, location) VALUES ($1, $2, ' + db.pointValue('$3','$4') + ') RETURNING id, name, description, ' + db.pointSelect(), [input.name, input.description || '', input.longitude, input.latitude]);
  return result.rows[0];
}
async function updateBuildingStatus(id, status){
  const result = await db.query(
    'UPDATE buildings SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, name, description, status, ' + db.pointSelect(),
    [id, status]
  );
  return result.rows[0] || null;
}
async function listNodes(){
  const result = await db.query('SELECT id, node_name, floor_label, node_type, is_published, is_staff_only, ' + db.pointSelect() + ' FROM graph_nodes ORDER BY id');
  return result.rows;
}
async function createNode(input){
  const result = await db.query('INSERT INTO graph_nodes (node_name, location, floor_label, node_type, is_published, is_staff_only) VALUES ($1, ' + db.pointValue('$2','$3') + ', $4, $5, $6, $7) RETURNING id, node_name, floor_label, node_type, is_published, is_staff_only, ' + db.pointSelect(), [input.node_name, input.longitude, input.latitude, input.floor_label || 'Ground', input.node_type || 'corridor', input.is_published !== false, input.is_staff_only === true]);
  return result.rows[0];
}
async function listRoutes(){
  const result = await db.query('SELECT r.id, r.start_node, r.end_node, r.distance, r.is_accessible, sn.node_name AS start_name, en.node_name AS end_name FROM graph_edges r LEFT JOIN graph_nodes sn ON sn.id = r.start_node LEFT JOIN graph_nodes en ON en.id = r.end_node ORDER BY r.id');
  return result.rows;
}
async function createRoute(input){
  const result = await db.query('INSERT INTO graph_edges (start_node, end_node, distance, is_accessible) VALUES ($1, $2, $3, $4) RETURNING id, start_node, end_node, distance, is_accessible', [input.start_node, input.end_node, input.distance, input.is_accessible !== false]);
  return result.rows[0];
}
async function listMarkers(){
  const result = await db.query('SELECT am.id, am.marker_name, am.model_path, am.linked_node, nn.node_name AS linked_node_name, am.status, ' + db.pointSelect('am.location') + ' FROM qr_anchors am LEFT JOIN graph_nodes nn ON nn.id = am.linked_node ORDER BY am.id');
  return result.rows;
}
async function createMarker(input){
  const result = await db.query('INSERT INTO qr_anchors (marker_name, location, model_path, linked_node, status) VALUES ($1, ' + db.pointValue('$2','$3') + ', $4, $5, $6) RETURNING id, marker_name, model_path, linked_node, status, ' + db.pointSelect(), [input.marker_name, input.longitude, input.latitude, input.model_path || '', input.linked_node || null, input.status || 'active']);
  return result.rows[0];
}
// ═══════════════════════════════════════════════════════════════════════════
// ── INDOOR SESSIONS  (Unity mobile app — always indoors) ─────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function createIndoorSession(input) {
  const result = await db.query(
    `INSERT INTO indoor_sessions
       (session_id, qr_id, destination, session_status, visited_node_ids, client_created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
     RETURNING *`,
    [
      input.session_id || input.client_session_id || null,
      input.qr_id || null,
      input.destination || input.end_node || null,
      input.session_status || null,
      JSON.stringify(input.visited_node_ids || []),
      input.client_created_at || null
    ]
  );
  await createSyncLog('mobile', 'indoor_session.create', 'indoor_session', String(result.rows[0].id), 'insert', { qr_id: input.qr_id || null });
  return result.rows[0];
}

async function updateIndoorSession(id, input) {
  const result = await db.query(
    `UPDATE indoor_sessions
     SET qr_id             = COALESCE($2, qr_id),
         destination       = COALESCE($3, destination),
         session_status    = COALESCE($4, session_status),
         visited_node_ids  = $5::jsonb,
         client_created_at = COALESCE($6::timestamptz, client_created_at)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.qr_id || null,
      input.destination || input.end_node || null,
      input.session_status || null,
      JSON.stringify(input.visited_node_ids || []),
      input.client_created_at || null
    ]
  );
  if (result.rows[0]) await createSyncLog('mobile', 'indoor_session.update', 'indoor_session', String(id), 'update', { session_status: input.session_status || null });
  return result.rows[0] || null;
}

async function upsertIndoorSessionByClientId(clientSessionId, input) {
  const existing = await db.query(
    'SELECT id FROM indoor_sessions WHERE session_id = $1 LIMIT 1',
    [clientSessionId]
  );
  if (existing.rowCount) {
    return updateIndoorSession(existing.rows[0].id, input);
  }
  return createIndoorSession({ ...input, session_id: clientSessionId });
}

async function listIndoorSessions(filters = {}) {
  let q = `
    SELECT s.*,
           gn.node_name AS destination_name,
           qa.marker_name AS ar_marker_name
      FROM indoor_sessions s
      LEFT JOIN graph_nodes gn ON gn.id::text = s.destination
      LEFT JOIN qr_anchors  qa ON qa.marker_name = s.qr_id OR qa.id::text = s.qr_id
  `;
  const params = [];
  const where = [];
  if (filters.status === 'active')  where.push("s.client_created_at >= NOW() - INTERVAL '15 minutes'");
  if (filters.status === 'failed')  where.push("s.session_status = 'cancelled'");
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY s.id DESC';
  return (await db.query(q, params)).rows;
}

async function listIndoorSyncs() {
  const r = await db.query(
    `SELECT 'inside' AS session_scope,
            MAX(client_created_at) AS last_sync_time,
            COUNT(*)::int AS session_count,
            SUM(CASE WHEN session_status='completed' THEN 1 ELSE 0 END)::int AS successful_count
       FROM indoor_sessions`
  );
  return r.rows[0] ? [r.rows[0]] : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// ── OUTDOOR SESSIONS  (outdoor navigation API + external sync) ────────────
// ═══════════════════════════════════════════════════════════════════════════

async function createOutdoorSession(input) {
  const result = await db.query(
    `INSERT INTO outdoor_sessions
       (session_id, from_name, to_name, qr_id, destination,
        session_status, distance_meters, visited_node_ids, client_created_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, COALESCE($9::timestamptz, NOW()), $10)
     RETURNING *`,
    [
      input.session_id || null,
      input.from_name || input.qr_id || null,           // human-readable start location
      input.to_name   || input.destination || null,     // human-readable end location
      input.qr_id     || input.from_name || null,       // also keep qr_id for compat
      input.destination || input.to_name || null,
      input.session_status || null,
      input.distance_meters || null,
      JSON.stringify(input.visited_node_ids || []),
      input.client_created_at || null,
      input.source || 'mobile'
    ]
  );
  await createSyncLog('outdoor', 'outdoor_session.create', 'outdoor_session', String(result.rows[0].id), 'insert', { from: input.from_name, to: input.to_name });
  return result.rows[0];
}

async function updateOutdoorSession(id, input) {
  const result = await db.query(
    `UPDATE outdoor_sessions
     SET from_name         = COALESCE($2, from_name),
         to_name           = COALESCE($3, to_name),
         session_status    = COALESCE($4, session_status),
         distance_meters   = COALESCE($5, distance_meters),
         visited_node_ids  = $6::jsonb,
         client_created_at = COALESCE($7::timestamptz, client_created_at)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.from_name || input.qr_id || null,
      input.to_name   || input.destination || null,
      input.session_status || null,
      input.distance_meters || null,
      JSON.stringify(input.visited_node_ids || []),
      input.client_created_at || null
    ]
  );
  return result.rows[0] || null;
}

async function upsertOutdoorSessionByClientId(clientSessionId, input) {
  const existing = await db.query(
    'SELECT id FROM outdoor_sessions WHERE session_id = $1 LIMIT 1',
    [clientSessionId]
  );
  if (existing.rowCount) {
    return updateOutdoorSession(existing.rows[0].id, input);
  }
  return createOutdoorSession({ ...input, session_id: clientSessionId });
}

async function listOutdoorSessions(filters = {}) {
  let q = `SELECT * FROM outdoor_sessions`;
  const where = [];
  if (filters.status === 'active') where.push("client_created_at >= NOW() - INTERVAL '15 minutes'");
  if (filters.status === 'failed') where.push("session_status = 'cancelled'");
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY id DESC';
  return (await db.query(q)).rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── LEGACY shims — route old calls to the right table ────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function createSession(input) {
  return (input.session_scope || 'inside') === 'outside'
    ? createOutdoorSession(input)
    : createIndoorSession(input);
}

// Upsert by session_id (client UUID): update if exists, create if not.
async function upsertSessionByClientId(clientSessionId, input) {
  return (input.session_scope || 'inside') === 'outside'
    ? upsertOutdoorSessionByClientId(clientSessionId, input)
    : upsertIndoorSessionByClientId(clientSessionId, input);
}

async function createSessions(items) {
  const saved = [];
  for (const item of items) saved.push(await createSession(item));
  return saved;
}
async function nearestNode(latitude, longitude){
  const result = await db.query('SELECT id, node_name, ' + db.pointSelect() + ', ST_Distance(location, ' + db.pointValue('$1','$2') + ') AS distance_meters FROM graph_nodes ORDER BY location <-> ' + db.pointValue('$1','$2') + ' LIMIT 1', [longitude, latitude]);
  return result.rows[0] || null;
}
async function dashboardCounts(){
  const [b, n, r, m, si, so] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS c FROM buildings'),
    db.query('SELECT COUNT(*)::int AS c FROM graph_nodes'),
    db.query('SELECT COUNT(*)::int AS c FROM graph_edges'),
    db.query('SELECT COUNT(*)::int AS c FROM qr_anchors'),
    db.query('SELECT COUNT(*)::int AS c FROM indoor_sessions'),
    db.query('SELECT COUNT(*)::int AS c FROM outdoor_sessions'),
  ]);
  return {
    buildings: b.rows[0].c,
    nodes:     n.rows[0].c,
    routes:    r.rows[0].c,
    markers:   m.rows[0].c,
    indoor_sessions:  si.rows[0].c,
    outdoor_sessions: so.rows[0].c,
    sessions: si.rows[0].c + so.rows[0].c   // combined for top-level KPI
  };
}
async function usageSeries(){
  const result = await db.query("SELECT to_char(day, 'Dy') AS label, route_requests::int, successful_routes::int FROM visit_series ORDER BY day");
  return result.rows;
}
async function popularNodes(){
  // Counts from indoor_sessions (indoor navigation — QR anchor → node destination)
  const result = await db.query(`
    SELECT nn.id, nn.node_name, COUNT(s.id)::int AS visits
      FROM graph_nodes nn
      LEFT JOIN indoor_sessions s ON s.destination = nn.id::text
     GROUP BY nn.id, nn.node_name
     ORDER BY visits DESC, nn.id
     LIMIT 8`);
  return result.rows;
}
async function heatPoints(){
  // Intensity based on indoor sessions only (indoor node passage counts)
  const result = await db.query(`
    WITH session_nodes AS (
      SELECT destination::text AS node_id FROM indoor_sessions WHERE destination IS NOT NULL
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(visited_node_ids, '[]'::jsonb)) AS node_id FROM indoor_sessions
    )
    SELECT nn.id, nn.node_name,
           ST_Y(nn.location::geometry) AS latitude,
           ST_X(nn.location::geometry) AS longitude,
           COUNT(sn.node_id)::int AS intensity
      FROM graph_nodes nn
      LEFT JOIN session_nodes sn ON sn.node_id = nn.id::text
     GROUP BY nn.id, nn.node_name, nn.location
     ORDER BY intensity DESC, nn.id
  `);
  return result.rows;
}
async function findAdminByEmail(email){
  const result = await db.query(`
    SELECT au.id, au.full_name, au.email, au.password_hash, au.role, au.role_id, au.is_active, au.last_login_at,
           COALESCE(r.name, au.role) AS role_name,
           COALESCE(array_agg(p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL), '{}') AS permissions
    FROM admin_users au
    LEFT JOIN roles r ON r.id = au.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE lower(au.email) = lower($1)
    GROUP BY au.id, r.id
    LIMIT 1
  `, [email]);
  return result.rows[0] || null;
}
async function findAdminById(id){
  const result = await db.query(`
    SELECT au.id, au.full_name, au.email, au.role, au.role_id, au.is_active, au.last_login_at,
           COALESCE(r.name, au.role) AS role_name,
           COALESCE(array_agg(p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL), '{}') AS permissions
    FROM admin_users au
    LEFT JOIN roles r ON r.id = au.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE au.id = $1
    GROUP BY au.id, r.id
    LIMIT 1
  `, [id]);
  return result.rows[0] || null;
}
async function updateAdminLastLogin(id){
  await db.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [id]);
}
async function getPermissionsForAdmin(id){
  const result = await db.query(`
    SELECT p.permission_key
    FROM admin_users au
    JOIN roles r ON r.id = au.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE au.id = $1
  `, [id]);
  return result.rows.map(row => row.permission_key);
}
async function getAccessControlOverview(){
  const [rolesResult, modulesResult, usersResult] = await Promise.all([
    db.query(`
      SELECT r.id, r.role_key AS key, r.name, r.description, r.is_system,
             COALESCE(array_agg(p.permission_key ORDER BY p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL), '{}') AS permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.id
    `),
    db.query(`
      SELECT m.id, m.module_key AS key, m.name, m.description,
             COALESCE(json_agg(json_build_object('id', p.id, 'key', p.action_key, 'name', p.name, 'permission', p.permission_key) ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL), '[]') AS actions
      FROM permission_modules m
      LEFT JOIN permissions p ON p.module_id = m.id
      GROUP BY m.id
      ORDER BY m.id
    `),
    db.query(`
      SELECT au.id, au.full_name, au.email, au.role, au.role_id, au.is_active, au.last_login_at,
             COALESCE(r.name, au.role) AS role_name,
             COALESCE(array_agg(p.permission_key ORDER BY p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL), '{}') AS permissions
      FROM admin_users au
      LEFT JOIN roles r ON r.id = au.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY au.id, r.id
      ORDER BY au.id
    `)
  ]);
  return { roles: rolesResult.rows, modules: modulesResult.rows, users: usersResult.rows };
}
async function createRole(input){
  const client = await db.pool.connect();
  try{
    await client.query('BEGIN');
    const created = await client.query('INSERT INTO roles (role_key, name, description) VALUES ($1,$2,$3) RETURNING id, role_key AS key, name, description, is_system', [input.key, input.name, input.description]);
    await setRolePermissions(client, created.rows[0].id, input.permissions);
    await client.query('COMMIT');
    return (await getAccessControlOverview()).roles.find(role => role.id === created.rows[0].id);
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}
async function updateRole(id, input){
  const client = await db.pool.connect();
  try{
    await client.query('BEGIN');
    const updated = await client.query('UPDATE roles SET name=$2, description=$3, updated_at=NOW() WHERE id=$1 RETURNING id', [id, input.name, input.description]);
    if(!updated.rowCount){ await client.query('ROLLBACK'); return null; }
    await setRolePermissions(client, id, input.permissions);
    await client.query('COMMIT');
    return (await getAccessControlOverview()).roles.find(role => role.id === Number(id));
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}
async function deleteRole(id){
  const assigned = await db.query('SELECT 1 FROM admin_users WHERE role_id=$1 LIMIT 1', [id]);
  if(assigned.rowCount) return false;
  const result = await db.query('DELETE FROM roles WHERE id=$1 AND is_system=FALSE', [id]);
  return result.rowCount > 0;
}
async function assignUserRole(userId, roleId){
  const result = await db.query(`
    UPDATE admin_users au
    SET role_id=$2, role=(SELECT role_key FROM roles WHERE id=$2), updated_at=NOW()
    WHERE au.id=$1 AND EXISTS (SELECT 1 FROM roles WHERE id=$2)
    RETURNING au.id
  `, [userId, roleId]);
  if(!result.rowCount) return null;
  return (await getAccessControlOverview()).users.find(user => user.id === Number(userId));
}
async function createAdminUser(input){
  const result = await db.query(`
    INSERT INTO admin_users (full_name, email, password_hash, role, role_id, is_active)
    SELECT $1, $2, $3, r.role_key, r.id, $5
    FROM roles r
    WHERE r.id = $4
    RETURNING id
  `, [input.fullName, input.email, input.passwordHash, input.roleId, input.isActive]);
  if(!result.rowCount) return null;
  return (await getAccessControlOverview()).users.find(user => user.id === result.rows[0].id);
}
async function updateAdminUser(id, input){
  const params = [id, input.fullName, input.email, input.roleId, input.isActive];
  let passwordSql = '';
  if(input.passwordHash){
    params.push(input.passwordHash);
    passwordSql = ', password_hash=$6';
  }
  const result = await db.query(`
    UPDATE admin_users au
    SET full_name=$2, email=$3, role_id=$4, role=(SELECT role_key FROM roles WHERE id=$4), is_active=$5, updated_at=NOW()${passwordSql}
    WHERE au.id=$1 AND EXISTS (SELECT 1 FROM roles WHERE id=$4)
    RETURNING au.id
  `, params);
  if(!result.rowCount) return null;
  return (await getAccessControlOverview()).users.find(user => user.id === Number(id));
}
async function deleteAdminUser(id){
  const result = await db.query('DELETE FROM admin_users WHERE id=$1', [id]);
  return result.rowCount > 0;
}
async function createPermissionModule(input){
  const client = await db.pool.connect();
  try{
    await client.query('BEGIN');
    const created = await client.query('INSERT INTO permission_modules (module_key, name, description) VALUES ($1,$2,$3) RETURNING id', [input.key, input.name, input.description]);
    await setModuleActions(client, created.rows[0].id, input.key, input.actions);
    await client.query('COMMIT');
    return (await getAccessControlOverview()).modules.find(module => module.id === created.rows[0].id);
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}
async function updatePermissionModule(id, input){
  const client = await db.pool.connect();
  try{
    await client.query('BEGIN');
    const updated = await client.query('UPDATE permission_modules SET name=$2, description=$3, updated_at=NOW() WHERE id=$1 RETURNING module_key', [id, input.name, input.description]);
    if(!updated.rowCount){ await client.query('ROLLBACK'); return null; }
    await setModuleActions(client, id, updated.rows[0].module_key, input.actions);
    await client.query('COMMIT');
    return (await getAccessControlOverview()).modules.find(module => module.id === Number(id));
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}
async function deletePermissionModule(id){
  const result = await db.query('DELETE FROM permission_modules WHERE id=$1', [id]);
  return result.rowCount > 0;
}
async function setRolePermissions(client, roleId, permissions){
  await client.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId]);
  const unique = [...new Set(Array.isArray(permissions) ? permissions : [])];
  for(const permission of unique){
    await client.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key=$2 ON CONFLICT DO NOTHING', [roleId, permission]);
  }
}
async function setModuleActions(client, moduleId, moduleKey, actions){
  const normalized = normalizeActions(actions);
  await client.query('DELETE FROM permissions WHERE module_id=$1 AND action_key <> ALL($2::text[])', [moduleId, normalized.map(action => action.key)]);
  for(const action of normalized){
    await client.query(`
      INSERT INTO permissions (module_id, action_key, permission_key, name)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (permission_key) DO UPDATE SET name=EXCLUDED.name, action_key=EXCLUDED.action_key
    `, [moduleId, action.key, moduleKey + '.' + action.key, action.name]);
  }
}
function normalizeActions(actions){
  return (Array.isArray(actions) ? actions : []).map(action => {
    const raw = typeof action === 'string' ? action : (action.key || action.name || '');
    const key = String(raw).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
    const name = typeof action === 'string' ? titleCase(key) : (action.name || titleCase(key));
    return key ? { key, name } : null;
  }).filter(Boolean);
}
function titleCase(value){
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

// Legacy updateSession — routes to correct table
async function updateSession(id, input){
  if ((input.session_scope || 'inside') === 'outside') {
    return updateOutdoorSession(id, input);
  }
  return updateIndoorSession(id, input);
}

// Legacy listSessions — routes to correct table by scope
async function listSessions(filters = {}){
  if (filters.scope === 'outside') return listOutdoorSessions(filters);
  return listIndoorSessions(filters);
}

async function listSyncs(){
  // Combined sync summary from both tables
  const [inR, outR] = await Promise.all([
    db.query(`SELECT 'inside' AS session_scope,
                     MAX(client_created_at) AS last_sync_time,
                     COUNT(*)::int AS session_count,
                     SUM(CASE WHEN session_status='completed' THEN 1 ELSE 0 END)::int AS successful_count
               FROM indoor_sessions`),
    db.query(`SELECT 'outside' AS session_scope,
                     MAX(client_created_at) AS last_sync_time,
                     COUNT(*)::int AS session_count,
                     SUM(CASE WHEN session_status='completed' THEN 1 ELSE 0 END)::int AS successful_count
               FROM outdoor_sessions`)
  ]);
  const result = { rows: [...inR.rows, ...outR.rows].filter(r => r.session_count > 0) };
  return result.rows;
}

async function listQrScans(){
  const result = await db.query(
    'SELECT qs.*, nn.node_name AS node_name FROM qr_scans qs LEFT JOIN graph_nodes nn ON nn.id = qs.resolved_node_id ORDER BY qs.id DESC'
  );
  return result.rows;
}

async function listPoiCategories(){
  const result = await db.query('SELECT * FROM poi_categories ORDER BY id');
  return result.rows;
}

async function createPoiCategory(input){
  const result = await db.query(
    'INSERT INTO poi_categories (name, key, description, is_published) VALUES ($1, $2, $3, $4) RETURNING *',
    [input.name, input.key, input.description || '', input.is_published !== false]
  );
  return result.rows[0];
}

async function patchPoiVisibility(id, input){
  const setClauses = [];
  const params = [id];
  let index = 2;
  if(input.is_published !== undefined){
    setClauses.push(`is_published = $${index++}`);
    params.push(input.is_published);
  }
  if(input.is_staff_only !== undefined){
    setClauses.push(`is_staff_only = $${index++}`);
    params.push(input.is_staff_only);
  }
  if(setClauses.length === 0) return null;
  const result = await db.query(
    `UPDATE graph_nodes SET ${setClauses.join(', ')} WHERE id = $1 RETURNING id, node_name, is_published, is_staff_only`,
    params
  );
  return result.rows[0] || null;
}

async function getAccessibilityOverview(){
  const routesRes = await db.query('SELECT COUNT(*)::int AS total, SUM(CASE WHEN is_accessible THEN 1 ELSE 0 END)::int AS accessible FROM graph_edges');
  const nodesRes = await db.query("SELECT COUNT(*)::int AS total FROM graph_nodes WHERE node_type = 'stairs'");
  const totalRoutes = routesRes.rows[0].total || 0;
  const accessibleRoutes = routesRes.rows[0].accessible || 0;
  const stairNodes = nodesRes.rows[0].total || 0;
  return {
    total_routes: totalRoutes,
    accessible_routes: accessibleRoutes,
    accessibility_percentage: totalRoutes > 0 ? Math.round((accessibleRoutes / totalRoutes) * 100) : 100,
    stair_nodes: stairNodes
  };
}

async function listAccessLogs(){
  const result = await db.query('SELECT * FROM access_logs ORDER BY id DESC');
  return result.rows;
}

async function createAccessLog(actor, action, target, role){
  const result = await db.query(
    'INSERT INTO access_logs (actor, action, target, role) VALUES ($1, $2, $3, $4) RETURNING *',
    [actor, action, target, role || null]
  );
  return result.rows[0];
}

// Resolve session_id: accepts either a DB integer id or a client UUID string.
async function resolveSessionDbId(sessionIdInput){
  if(!sessionIdInput) return null;
  const asInt = Number(sessionIdInput);
  if(Number.isInteger(asInt) && asInt > 0) return asInt;
  // UUID string — look in indoor_sessions first (feedback comes from mobile/indoor)
  const r = await db.query(
    'SELECT id FROM indoor_sessions WHERE session_id = $1 LIMIT 1',
    [String(sessionIdInput)]
  );
  return r.rows[0]?.id || null;
}

async function createFeedback(input){
  const sessionDbId = await resolveSessionDbId(input.session_id);
  const result = await db.query(
    'INSERT INTO feedback (type, chips, message, rating, session_id, node_id, status) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7) RETURNING *',
    [input.type || 'feedback', JSON.stringify(input.chips || []), input.message, input.rating || null, sessionDbId, input.node_id || null, 'open']
  );
  await createSyncLog('mobile', 'feedback.create', 'feedback', String(result.rows[0].id), 'insert', { chips: input.chips || [], session_id: sessionDbId });
  return result.rows[0];
}

async function listFeedback(type){
  // Feedback session_id references indoor_sessions (feedback comes from the mobile/indoor app)
  let queryText = 'SELECT f.*, is2.qr_id, nn.node_name FROM feedback f LEFT JOIN indoor_sessions is2 ON is2.id = f.session_id LEFT JOIN graph_nodes nn ON nn.id = f.node_id';
  const params = [];
  if(type){
    queryText += ' WHERE f.type = $1';
    params.push(type);
  }
  queryText += ' ORDER BY f.id DESC';
  const result = await db.query(queryText, params);
  return result.rows;
}

async function updateFeedbackStatus(id, status){
  const result = await db.query('UPDATE feedback SET status = $2 WHERE id = $1 RETURNING *', [id, status]);
  return result.rows[0] || null;
}

async function getSettings(){
  const result = await db.query('SELECT * FROM system_settings');
  return result.rows;
}

async function getSettingsByCategory(category){
  const result = await db.query('SELECT settings_json FROM system_settings WHERE category = $1', [category]);
  return result.rows[0]?.settings_json || null;
}

async function updateSettingsByCategory(category, settingsJson){
  const result = await db.query(
    'INSERT INTO system_settings (category, settings_json) VALUES ($1, $2) ON CONFLICT (category) DO UPDATE SET settings_json = EXCLUDED.settings_json RETURNING *',
    [category, JSON.stringify(settingsJson)]
  );
  return result.rows[0].settings_json;
}

async function mergeSourceRecord(record){
  const result = await db.query(`
    INSERT INTO source_records (source, record_type, dedupe_key, external_id, name, latitude, longitude, data_json, first_seen_at, last_seen_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW())
    ON CONFLICT (source, record_type, dedupe_key)
    DO UPDATE SET
      external_id = COALESCE(EXCLUDED.external_id, source_records.external_id),
      name = COALESCE(EXCLUDED.name, source_records.name),
      latitude = COALESCE(EXCLUDED.latitude, source_records.latitude),
      longitude = COALESCE(EXCLUDED.longitude, source_records.longitude),
      data_json = source_records.data_json || EXCLUDED.data_json,
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted
  `, [
    record.source,
    record.record_type,
    record.dedupe_key,
    record.external_id || null,
    record.name || null,
    record.latitude ?? null,
    record.longitude ?? null,
    JSON.stringify(record.data_json || {})
  ]);
  const row = result.rows[0];
  await createSyncLog(record.source, 'record.merge', record.record_type, record.dedupe_key, row.inserted ? 'insert' : 'merge', { source_record_id: row.id });
  return row;
}

async function mergeSourceRecords(records){
  const summary = { inserted: 0, merged: 0, total: 0 };
  for(const record of records){
    const row = await mergeSourceRecord(record);
    summary.total += 1;
    if(row.inserted) summary.inserted += 1;
    else summary.merged += 1;
  }
  return summary;
}

async function listSourceRecords(recordType, limit = 200){
  const result = await db.query(
    `SELECT *
     FROM source_records
     WHERE source = 'outdoor' AND record_type = $1
     ORDER BY last_seen_at DESC, id DESC
     LIMIT $2`,
    [recordType, limit]
  );
  return result.rows;
}

async function createSyncLog(source, operation, recordType, dedupeKey, action, details = {}){
  const result = await db.query(
    'INSERT INTO sync_logs (source, operation, record_type, dedupe_key, action, details_json) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *',
    [source, operation, recordType || null, dedupeKey || null, action || null, JSON.stringify(details || {})]
  );
  return result.rows[0];
}

async function blockHeatData() {
  // Uses indoor_sessions — block heat = how many indoor navigation sessions
  // passed through each building block (destination + visited nodes)
  const result = await db.query(`
    WITH session_nodes AS (
      SELECT destination::text AS node_id
        FROM indoor_sessions
       WHERE destination IS NOT NULL
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(visited_node_ids, '[]'::jsonb)) AS node_id
        FROM indoor_sessions
    ),
    tagged AS (
      SELECT gn.id::text AS node_id,
             CASE
               WHEN gn.node_name LIKE 'Block B%' THEN 'B'
               WHEN gn.node_name LIKE 'Block C%' THEN 'C'
               WHEN gn.node_name LIKE 'Block F%' THEN 'F'
               WHEN gn.node_name LIKE 'Block G%' THEN 'G'
               WHEN gn.node_name LIKE 'Block H%' THEN 'H'
             END AS block_id
        FROM graph_nodes gn
       WHERE gn.node_name ~ '^Block [BCFGH]'
    )
    SELECT t.block_id, COALESCE(COUNT(sn.node_id), 0)::int AS visit_count
      FROM tagged t
      LEFT JOIN session_nodes sn ON sn.node_id = t.node_id
     GROUP BY t.block_id
     ORDER BY t.block_id
  `);
  return result.rows; // [{ block_id: 'B', visit_count: 42 }, ...]
}

module.exports = {
  // Nodes / edges / markers / buildings
  listBuildings, createBuilding, updateBuildingStatus,
  listNodes, createNode,
  listRoutes, createRoute,
  listMarkers, createMarker,

  // Indoor sessions (mobile Unity app)
  createIndoorSession, updateIndoorSession, upsertIndoorSessionByClientId,
  listIndoorSessions, listIndoorSyncs,

  // Outdoor sessions (outdoor navigation API)
  createOutdoorSession, updateOutdoorSession, upsertOutdoorSessionByClientId,
  listOutdoorSessions,

  // Legacy shims (route to the right table based on scope)
  createSession, updateSession, upsertSessionByClientId, createSessions,

  // Dashboard / analytics
  nearestNode, dashboardCounts, usageSeries, popularNodes, heatPoints, blockHeatData,

  // Auth / access control
  findAdminByEmail, findAdminById, updateAdminLastLogin, getPermissionsForAdmin,
  getAccessControlOverview,
  createRole, updateRole, deleteRole, assignUserRole,
  createAdminUser, updateAdminUser, deleteAdminUser,
  createPermissionModule, updatePermissionModule, deletePermissionModule,

  // Misc
  listSessions, listSyncs, listQrScans, listPoiCategories, createPoiCategory, patchPoiVisibility,
  getAccessibilityOverview, listAccessLogs, createAccessLog,
  createFeedback, listFeedback, updateFeedbackStatus,
  getSettings, getSettingsByCategory, updateSettingsByCategory,
  mergeSourceRecord, mergeSourceRecords, listSourceRecords, createSyncLog,
  blockHeatData
};
