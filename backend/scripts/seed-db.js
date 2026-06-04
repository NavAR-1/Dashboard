require('../src/config/env');
const { pool } = require('../src/infrastructure/database/postgres');
const { hashPassword } = require('../src/domain/password');

async function main(){
  console.log('Truncating tables...');
  // Truncate both session tables + legacy table + all dependent tables
  await pool.query('TRUNCATE access_logs, feedback, system_settings, qr_scans, poi_categories, indoor_sessions, outdoor_sessions, navigation_sessions, graph_edges, qr_anchors, graph_nodes, buildings, admin_users RESTART IDENTITY CASCADE');
  // visit_series is a VIEW derived from indoor_sessions — no truncate needed

  console.log('Inserting admin users...');
  const roles = await pool.query('SELECT id, role_key FROM roles');
  const adminRole = roles.rows.find(r => r.role_key === 'admin');
  const facilityRole = roles.rows.find(r => r.role_key === 'facility_manager');
  const analystRole = roles.rows.find(r => r.role_key === 'analyst');

  await pool.query('INSERT INTO admin_users (full_name, email, password_hash, role, role_id) VALUES ($1,$2,$3,$4,$5)', 
    ['Admin User', 'admin@navar.local', hashPassword('Admin@12345'), 'admin', adminRole?.id]);
  await pool.query('INSERT INTO admin_users (full_name, email, password_hash, role, role_id) VALUES ($1,$2,$3,$4,$5)', 
    ['Facility Manager', 'facility@navar.local', hashPassword('Facility@12345'), 'facility_manager', facilityRole?.id]);
  await pool.query('INSERT INTO admin_users (full_name, email, password_hash, role, role_id) VALUES ($1,$2,$3,$4,$5)', 
    ['Analytics Viewer', 'analyst@navar.local', hashPassword('Analyst@12345'), 'analyst', analystRole?.id]);

  console.log('Inserting buildings...');
  const bRes = await pool.query("INSERT INTO buildings (name, description, location) VALUES " +
    "('Block B', 'Artificial Intelligence & Robotics Excellence Center', ST_SetSRID(ST_MakePoint(38.80992, 8.88957), 4326)::geography)," +
    "('Block C', 'High-Performance Computing & Big Data Analytics', ST_SetSRID(ST_MakePoint(38.81024, 8.88870), 4326)::geography)," +
    "('Block F', 'Sustainable Energy Technology Excellence Center', ST_SetSRID(ST_MakePoint(38.81056, 8.88924), 4326)::geography)," +
    "('Block G', 'Nuclear Reactor Excellence Center', ST_SetSRID(ST_MakePoint(38.81008, 8.89014), 4326)::geography)," +
    "('Block H', 'Central Laboratory Spine', ST_SetSRID(ST_MakePoint(38.81016, 8.88951), 4326)::geography) RETURNING id, name");
  
  const bId = {};
  bRes.rows.forEach(r => bId[r.name] = r.id);

  console.log('Inserting POI categories...');
  await pool.query(`
    INSERT INTO poi_categories (name, key, description, is_published) VALUES
    ('Academic', 'academic', 'Classrooms, lecture halls, and academic departments', TRUE),
    ('Service', 'service', 'Restrooms, info desks, cafes, and campus services', TRUE),
    ('Office', 'office', 'Faculty and administrative offices', TRUE),
    ('Lab', 'lab', 'Research and computer laboratories', TRUE)
  `);

  console.log('Inserting navigation nodes...');
  const nodes = [];

  // BLOCK B: AI & Robotics
  const baseB = [38.80992, 8.88957];
  // Level 1 (Ground)
  nodes.push({ name: 'Block B - Main Entrance Lobby', lon: baseB[0], lat: baseB[1], floor: 'Level 1', type: 'entrance', published: true, staff: false });
  nodes.push({ name: 'Block B - Director of Research Center Office', lon: baseB[0] + 0.00005, lat: baseB[1] + 0.00002, floor: 'Level 1', type: 'office', published: true, staff: true });
  nodes.push({ name: 'Block B - Deputy Director Office', lon: baseB[0] + 0.00006, lat: baseB[1] - 0.00002, floor: 'Level 1', type: 'office', published: true, staff: true });
  nodes.push({ name: 'Block B - Secretary Office Cell 1', lon: baseB[0] + 0.00003, lat: baseB[1] + 0.00005, floor: 'Level 1', type: 'office', published: true, staff: false });
  nodes.push({ name: 'Block B - Secretary Office Cell 2', lon: baseB[0] + 0.00004, lat: baseB[1] - 0.00005, floor: 'Level 1', type: 'office', published: true, staff: false });
  nodes.push({ name: 'Block B - Support Staff Suite A', lon: baseB[0] - 0.00005, lat: baseB[1] + 0.00002, floor: 'Level 1', type: 'office', published: true, staff: false });
  nodes.push({ name: 'Block B - Support Staff Suite B', lon: baseB[0] - 0.00006, lat: baseB[1] - 0.00002, floor: 'Level 1', type: 'office', published: true, staff: false });
  nodes.push({ name: 'Block B - L1 Ladies Toilet', lon: baseB[0] - 0.00008, lat: baseB[1] + 0.00007, floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block B - L1 Gents Toilet', lon: baseB[0] - 0.00008, lat: baseB[1] - 0.00007, floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block B - L1 Disabled Toilet', lon: baseB[0] - 0.00009, lat: baseB[1], floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block B - L1 Janitor Room', lon: baseB[0] - 0.00010, lat: baseB[1] - 0.00001, floor: 'Level 1', type: 'service', published: true, staff: true });
  
  // Levels 2 to 4 (Lobbies, Meeting Rooms, Research Offices)
  for (let lvl of [2, 3, 4]) {
    const floorLabel = `Level ${lvl}`;
    const latOffset = (lvl - 1) * 0.00002;
    nodes.push({ name: `Block B - Central Floor Lobby ${floorLabel}`, lon: baseB[0], lat: baseB[1] + latOffset, floor: floorLabel, type: 'lobby', published: true, staff: false });
    nodes.push({ name: `Block B - Main Interactive Meeting Room ${floorLabel}`, lon: baseB[0] + 0.00005, lat: baseB[1] + latOffset + 0.00001, floor: floorLabel, type: 'meeting', published: true, staff: false });
    nodes.push({ name: `Block B - Research Office Type 1 ${floorLabel}`, lon: baseB[0] - 0.00005, lat: baseB[1] + latOffset - 0.00002, floor: floorLabel, type: 'office', published: true, staff: false });
    nodes.push({ name: `Block B - Research Office Type 2 ${floorLabel}`, lon: baseB[0] - 0.00007, lat: baseB[1] + latOffset + 0.00003, floor: floorLabel, type: 'office', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Ladies Toilet`, lon: baseB[0] + 0.00008, lat: baseB[1] + latOffset - 0.00007, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Gents Toilet`, lon: baseB[0] + 0.00008, lat: baseB[1] + latOffset + 0.00007, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Disabled Toilet`, lon: baseB[0] + 0.00009, lat: baseB[1] + latOffset, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Janitor Room`, lon: baseB[0] + 0.00010, lat: baseB[1] + latOffset - 0.00001, floor: floorLabel, type: 'service', published: true, staff: true });
  }

  // Levels 5 & 6 (AI & Robotics Testing Field)
  for (let lvl of [5, 6]) {
    const floorLabel = `Level ${lvl}`;
    const latOffset = (lvl - 1) * 0.00002;
    nodes.push({ name: `Block B - Primary Robotics & AI Testing Lab Field ${floorLabel}`, lon: baseB[0], lat: baseB[1] + latOffset, floor: floorLabel, type: 'lab', published: true, staff: false });
    nodes.push({ name: `Block B - Central Floor Lobby ${floorLabel}`, lon: baseB[0] + 0.00006, lat: baseB[1] + latOffset - 0.00005, floor: floorLabel, type: 'lobby', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Ladies Toilet`, lon: baseB[0] + 0.00008, lat: baseB[1] + latOffset - 0.00007, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Gents Toilet`, lon: baseB[0] + 0.00008, lat: baseB[1] + latOffset + 0.00007, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Disabled Toilet`, lon: baseB[0] + 0.00009, lat: baseB[1] + latOffset, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block B - ${floorLabel} Janitor Room`, lon: baseB[0] + 0.00010, lat: baseB[1] + latOffset - 0.00001, floor: floorLabel, type: 'service', published: true, staff: true });
  }

  // BLOCK C: HPC & Big Data
  const baseC = [38.81024, 8.88870];
  // Level -1.2 (Lower Basement)
  nodes.push({ name: 'Block C - Lower Basement Enclosed Parking Field Area', lon: baseC[0], lat: baseC[1], floor: 'Level -1.2', type: 'parking', published: true, staff: false });
  nodes.push({ name: 'Block C - Lower Basement Central Transition Corridor', lon: baseC[0] + 0.00003, lat: baseC[1] + 0.00001, floor: 'Level -1.2', type: 'corridor', published: true, staff: false });
  
  // Level -1.1 (Upper Basement)
  nodes.push({ name: 'Block C - Upper Basement Enclosed Parking Field Area', lon: baseC[0], lat: baseC[1] - 0.00005, floor: 'Level -1.1', type: 'parking', published: true, staff: false });
  nodes.push({ name: 'Block C - Upper Basement Central Transition Corridor', lon: baseC[0] + 0.00003, lat: baseC[1] - 0.00004, floor: 'Level -1.1', type: 'corridor', published: true, staff: false });

  // Levels 0 to 5 (Ground to 5th Floor)
  for (let lvl of [0, 1, 2, 3, 4, 5]) {
    const floorLabel = lvl === 0 ? 'Ground' : `Level ${lvl}`;
    const latOffset = lvl * 0.00002;
    nodes.push({ name: `Block C - HPC & Interior Design Lab ${floorLabel}`, lon: baseC[0] + 0.00005, lat: baseC[1] + latOffset, floor: floorLabel, type: 'lab', published: true, staff: false });
    nodes.push({ name: `Block C - Central Circulation Corridor & Lift Lobby ${floorLabel}`, lon: baseC[0], lat: baseC[1] + latOffset - 0.00002, floor: floorLabel, type: 'lobby', published: true, staff: false });
    nodes.push({ name: `Block C - ${floorLabel} Ladies Toilet`, lon: baseC[0] - 0.00005, lat: baseC[1] + latOffset + 0.00003, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block C - ${floorLabel} Gents Toilet`, lon: baseC[0] - 0.00005, lat: baseC[1] + latOffset - 0.00003, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block C - ${floorLabel} Disabled WC`, lon: baseC[0] - 0.00006, lat: baseC[1] + latOffset, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block C - ${floorLabel} Janitor Utility Room`, lon: baseC[0] - 0.00007, lat: baseC[1] + latOffset + 0.00001, floor: floorLabel, type: 'service', published: true, staff: true });
    nodes.push({ name: `Block C - ${floorLabel} External Heat Exhaust Balcony`, lon: baseC[0] + 0.00008, lat: baseC[1] + latOffset + 0.00004, floor: floorLabel, type: 'service', published: true, staff: false });
  }

  // BLOCK F: Sustainable Energy Technology
  const baseF = [38.81056, 8.88924];
  // Level 1 (Ground)
  nodes.push({ name: 'Block F - Main Lobby Node', lon: baseF[0], lat: baseF[1], floor: 'Level 1', type: 'entrance', published: true, staff: false });
  nodes.push({ name: 'Block F - Technical Reference Library Wing', lon: baseF[0] + 0.00004, lat: baseF[1] + 0.00003, floor: 'Level 1', type: 'library', published: true, staff: false });
  nodes.push({ name: 'Block F - Sustainable Energy Briefing Room', lon: baseF[0] - 0.00004, lat: baseF[1] - 0.00003, floor: 'Level 1', type: 'meeting', published: true, staff: false });
  nodes.push({ name: 'Block F - L1 Ladies Toilet', lon: baseF[0] - 0.00006, lat: baseF[1] + 0.00004, floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block F - L1 Gents Toilet', lon: baseF[0] - 0.00006, lat: baseF[1] - 0.00004, floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block F - L1 Disabled Toilet', lon: baseF[0] - 0.00007, lat: baseF[1], floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block F - L1 Janitor Room', lon: baseF[0] - 0.00008, lat: baseF[1] + 0.00001, floor: 'Level 1', type: 'service', published: true, staff: true });

  // Level 2 to Level 6
  for (let lvl of [2, 3, 4, 5, 6]) {
    const floorLabel = `Level ${lvl}`;
    const latOffset = (lvl - 1) * 0.00002;
    nodes.push({ name: `Block F - Sustainable Energy Research Lab Core ${floorLabel}`, lon: baseF[0] + 0.00004, lat: baseF[1] + latOffset, floor: floorLabel, type: 'lab', published: true, staff: false });
    nodes.push({ name: `Block F - Horizontal Transit Corridor ${floorLabel}`, lon: baseF[0], lat: baseF[1] + latOffset - 0.00002, floor: floorLabel, type: 'corridor', published: true, staff: false });
    nodes.push({ name: `Block F - Floor Lobby Node ${floorLabel}`, lon: baseF[0] - 0.00003, lat: baseF[1] + latOffset + 0.00001, floor: floorLabel, type: 'lobby', published: true, staff: false });
    nodes.push({ name: `Block F - External Structural Safety Balcony ${floorLabel}`, lon: baseF[0] - 0.00006, lat: baseF[1] + latOffset - 0.00004, floor: floorLabel, type: 'balcony', published: true, staff: false });
    nodes.push({ name: `Block F - ${floorLabel} Ladies Toilet`, lon: baseF[0] + 0.00007, lat: baseF[1] + latOffset + 0.00004, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block F - ${floorLabel} Gents Toilet`, lon: baseF[0] + 0.00007, lat: baseF[1] + latOffset - 0.00004, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block F - ${floorLabel} Disabled Toilet`, lon: baseF[0] + 0.00008, lat: baseF[1] + latOffset, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block F - ${floorLabel} Janitor Room`, lon: baseF[0] + 0.00009, lat: baseF[1] + latOffset + 0.00001, floor: floorLabel, type: 'service', published: true, staff: true });
    nodes.push({ name: `Block F - Vertical Riser Core Connection ${floorLabel}`, lon: baseF[0] - 0.00005, lat: baseF[1] + latOffset + 0.00005, floor: floorLabel, type: 'service', published: true, staff: true });
  }

  // BLOCK G: Nuclear Reactor
  const baseG = [38.81008, 8.89014];
  // Level 1 (Ground)
  nodes.push({ name: 'Block G - Primary Reactor Lobby Zone', lon: baseG[0], lat: baseG[1], floor: 'Level 1', type: 'lobby', published: true, staff: false });
  nodes.push({ name: 'Block G - Auditorium / Executive Meeting Room', lon: baseG[0] - 0.00005, lat: baseG[1] - 0.00002, floor: 'Level 1', type: 'meeting', published: true, staff: false });
  nodes.push({ name: 'Block G - Reactor Reference Library', lon: baseG[0] + 0.00005, lat: baseG[1] + 0.00002, floor: 'Level 1', type: 'library', published: true, staff: false });
  nodes.push({ name: 'Block G - Main Circulation Hallway Corridor', lon: baseG[0], lat: baseG[1] - 0.00004, floor: 'Level 1', type: 'corridor', published: true, staff: false });
  nodes.push({ name: 'Block G - L1 Ladies Toilet', lon: baseG[0] - 0.00008, lat: baseG[1] + 0.00004, floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block G - L1 Gents Toilet', lon: baseG[0] - 0.00008, lat: baseG[1] - 0.00004, floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block G - L1 Disabled Toilet', lon: baseG[0] - 0.00009, lat: baseG[1], floor: 'Level 1', type: 'service', published: true, staff: false });
  nodes.push({ name: 'Block G - L1 Janitor Room', lon: baseG[0] - 0.00010, lat: baseG[1] - 0.00001, floor: 'Level 1', type: 'service', published: true, staff: true });

  // Level 2 to Level 5
  for (let lvl of [2, 3, 4, 5]) {
    const floorLabel = `Level ${lvl}`;
    const latOffset = (lvl - 1) * 0.00002;
    nodes.push({ name: `Block G - Distributed Office Unit A ${floorLabel}`, lon: baseG[0] + 0.00004, lat: baseG[1] + latOffset - 0.00002, floor: floorLabel, type: 'office', published: true, staff: false });
    nodes.push({ name: `Block G - Distributed Office Unit B ${floorLabel}`, lon: baseG[0] - 0.00004, lat: baseG[1] + latOffset + 0.00002, floor: floorLabel, type: 'office', published: true, staff: false });
    nodes.push({ name: `Block G - Central Floor Lobby Zone ${floorLabel}`, lon: baseG[0], lat: baseG[1] + latOffset, floor: floorLabel, type: 'lobby', published: true, staff: false });
    nodes.push({ name: `Block G - Main Horizontal Corridor Axis ${floorLabel}`, lon: baseG[0], lat: baseG[1] + latOffset - 0.00004, floor: floorLabel, type: 'corridor', published: true, staff: false });
    nodes.push({ name: `Block G - Perimeter Wrap-Around Balcony ${floorLabel}`, lon: baseG[0] + 0.00007, lat: baseG[1] + latOffset + 0.00005, floor: floorLabel, type: 'balcony', published: true, staff: false });
    nodes.push({ name: `Block G - ${floorLabel} Ladies Toilet`, lon: baseG[0] - 0.00008, lat: baseG[1] + latOffset + 0.00004, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block G - ${floorLabel} Gents Toilet`, lon: baseG[0] - 0.00008, lat: baseG[1] + latOffset - 0.00004, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block G - ${floorLabel} Disabled Toilet`, lon: baseG[0] - 0.00009, lat: baseG[1] + latOffset, floor: floorLabel, type: 'service', published: true, staff: false });
    nodes.push({ name: `Block G - ${floorLabel} Janitor Room`, lon: baseG[0] - 0.00010, lat: baseG[1] + latOffset - 0.00001, floor: floorLabel, type: 'service', published: true, staff: true });
    nodes.push({ name: `Block G - Riser Core Void ${floorLabel}`, lon: baseG[0] + 0.00005, lat: baseG[1] + latOffset + 0.00006, floor: floorLabel, type: 'service', published: true, staff: true });
  }

  // BLOCK H: Central Laboratory Spine (Level 1 to 6 Symmetrical)
  const baseH = [38.81016, 8.88951];
  for (let lvl of [1, 2, 3, 4, 5, 6]) {
    const floorLabel = lvl === 1 ? 'Ground' : `Level ${lvl}`;
    const latOffset = (lvl - 1) * 0.00002;
    nodes.push({ name: `Block H - Main Intersecting Corridor ${floorLabel}`, lon: baseH[0], lat: baseH[1] + latOffset, floor: floorLabel, type: 'corridor', published: true, staff: false });
    nodes.push({ name: `Block H - High-Volume Pedestrian Lobby ${floorLabel}`, lon: baseH[0] - 0.00003, lat: baseH[1] + latOffset + 0.00001, floor: floorLabel, type: 'lobby', published: true, staff: false });
    nodes.push({ name: `Block H - Heavy-Lift Elevator Shaft ${floorLabel}`, lon: baseH[0] + 0.00004, lat: baseH[1] + latOffset - 0.00002, floor: floorLabel, type: 'elevator', published: true, staff: false });
    nodes.push({ name: `Block H - Concrete Staircase A ${floorLabel}`, lon: baseH[0] - 0.00005, lat: baseH[1] + latOffset - 0.00003, floor: floorLabel, type: 'stairs', published: true, staff: false });
    nodes.push({ name: `Block H - Concrete Staircase B ${floorLabel}`, lon: baseH[0] + 0.00005, lat: baseH[1] + latOffset + 0.00003, floor: floorLabel, type: 'stairs', published: true, staff: false });
    nodes.push({ name: `Block H - Diagonal Connection Bridge ${floorLabel}`, lon: baseH[0] - 0.00006, lat: baseH[1] + latOffset + 0.00004, floor: floorLabel, type: 'bridge', published: true, staff: false });
  }

  console.log(`Writing ${nodes.length} nodes to database...`);
  const nodeMap = [];
  for(let n of nodes){
    const res = await pool.query(
      'INSERT INTO graph_nodes (node_name, latitude, longitude, location, floor_label, node_type, is_published, is_staff_only) ' +
      'VALUES ($1, $3, $2, ST_SetSRID(ST_MakePoint($2,$3), 4326)::geography, $4, $5, $6, $7) RETURNING id, node_name',
      [n.name, n.lon, n.lat, n.floor, n.type, n.published, n.staff]
    );
    nodeMap.push(res.rows[0]);
  }

  console.log('Seeding routes...');
  // Let's create some logical routes (mostly connecting sequentially and between corridors/stairs)
  // Store generated routes
  for(let i = 0; i < nodeMap.length - 1; i++){
    // connect consecutive nodes in the list with a random distance between 5.0 and 20.0 meters
    if (i % 5 !== 0) { // Keep some separation
      const distance = Math.round((5 + Math.random() * 15) * 10) / 10;
      await pool.query('INSERT INTO graph_edges (start_node, end_node, distance) VALUES ($1,$2,$3)', [nodeMap[i].id, nodeMap[i+1].id, distance]);
    }
  }

  // Connect diagonals bridges from H to B, C, F, G on Level 1 & 2
  const blockBEntry = nodeMap.find(n => n.node_name === 'Block B - Main Entrance Lobby');
  const blockCEntry = nodeMap.find(n => n.node_name === 'Block C - Central Circulation Corridor & Lift Lobby Ground');
  const blockFEntry = nodeMap.find(n => n.node_name === 'Block F - Main Lobby Node');
  const blockGEntry = nodeMap.find(n => n.node_name === 'Block G - Primary Reactor Lobby Zone');
  const blockHEntry = nodeMap.find(n => n.node_name === 'Block H - Diagonal Connection Bridge Ground');
  
  if (blockHEntry && blockBEntry) await pool.query('INSERT INTO graph_edges (start_node, end_node, distance) VALUES ($1,$2,$3)', [blockHEntry.id, blockBEntry.id, 12.8]);
  if (blockHEntry && blockCEntry) await pool.query('INSERT INTO graph_edges (start_node, end_node, distance) VALUES ($1,$2,$3)', [blockHEntry.id, blockCEntry.id, 14.5]);
  if (blockHEntry && blockFEntry) await pool.query('INSERT INTO graph_edges (start_node, end_node, distance) VALUES ($1,$2,$3)', [blockHEntry.id, blockFEntry.id, 16.2]);
  if (blockHEntry && blockGEntry) await pool.query('INSERT INTO graph_edges (start_node, end_node, distance) VALUES ($1,$2,$3)', [blockHEntry.id, blockGEntry.id, 11.3]);

  console.log('Seeding AR markers...');
  const arMarkers = [
    { name: 'QR-B-G-Lobby', lon: baseB[0], lat: baseB[1], path: '/models/block-b-ground.glb', nodeName: 'Block B - Main Entrance Lobby' },
    { name: 'QR-C-G-Corridor', lon: baseC[0], lat: baseC[1] + 0.00002, path: '/models/block-c-ground.glb', nodeName: 'Block C - Central Circulation Corridor & Lift Lobby Ground' },
    { name: 'QR-F-G-Lobby', lon: baseF[0], lat: baseF[1], path: '/models/block-f-ground.glb', nodeName: 'Block F - Main Lobby Node' },
    { name: 'QR-G-G-Reactor', lon: baseG[0], lat: baseG[1], path: '/models/block-g-ground.glb', nodeName: 'Block G - Primary Reactor Lobby Zone' },
    { name: 'QR-H-G-Spine', lon: baseH[0], lat: baseH[1], path: '/models/block-h-ground.glb', nodeName: 'Block H - Main Intersecting Corridor Ground' }
  ];

  for (let m of arMarkers) {
    const linkedNode = nodeMap.find(n => n.node_name === m.nodeName);
    await pool.query(
      'INSERT INTO qr_anchors (marker_name, latitude, longitude, location, model_path, linked_node, status) VALUES ($1, $3, $2, ST_SetSRID(ST_MakePoint($2,$3), 4326)::geography, $4, $5, $6)',
      [m.name, m.lon, m.lat, m.path, linkedNode?.id || null, 'active']
    );
  }

  // visit_series is a live VIEW derived from navigation_sessions — no insert needed.

  console.log('Seeding navigation sessions...');
  // Let's create some sessions
  const bLobbyNode = nodeMap.find(n => n.node_name === 'Block B - Main Entrance Lobby');
  const bResearchNode = nodeMap.find(n => n.node_name === 'Block B - Director of Research Center Office');
  const cComputingNode = nodeMap.find(n => n.node_name === 'Block C - HPC & Interior Design Lab Ground');
  const fLobbyNode = nodeMap.find(n => n.node_name === 'Block F - Main Lobby Node');
  const qrMarkerRows = await pool.query('SELECT id, marker_name, linked_node FROM qr_anchors ORDER BY id');
  const markerForNode = nodeId => qrMarkerRows.rows.find(marker => marker.linked_node === nodeId)?.marker_name || `AR-${nodeId || 'UNKNOWN'}`;

  // Indoor sessions — seeded into indoor_sessions (from mobile Unity app)
  const indoorData = [
    { start: bLobbyNode?.id, end: bResearchNode?.id,  session_status: 'completed', session_id: 'inside-demo-001' },
    { start: bLobbyNode?.id, end: cComputingNode?.id, session_status: 'completed', session_id: 'inside-demo-002' },
    { start: fLobbyNode?.id, end: bResearchNode?.id,  session_status: 'cancelled', session_id: 'inside-demo-003' },
  ];

  const indoorSessionIds = [];
  for (const s of indoorData) {
    if (!s.start || !s.end) continue;
    const res = await pool.query(
      `INSERT INTO indoor_sessions (qr_id, destination, session_status, visited_node_ids, session_id, client_created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW() - INTERVAL '3 hours') RETURNING id`,
      [markerForNode(s.start), String(s.end), s.session_status, JSON.stringify([String(s.start)]), s.session_id]
    );
    indoorSessionIds.push(res.rows[0].id);
  }

  // Outdoor sessions — seeded into outdoor_sessions (from outdoor navigation API)
  const outdoorData = [
    { qr_id: 'QR-C-G-Corridor', dest: fLobbyNode?.id,    session_status: 'completed', session_id: 'outside-demo-001', source: 'demo' },
    { qr_id: 'QR-B-G-Lobby',    dest: fLobbyNode?.id,    session_status: 'completed', session_id: 'outside-demo-002', source: 'demo' },
    { qr_id: 'QR-F-G-Lobby',    dest: cComputingNode?.id, session_status: 'cancelled', session_id: 'outside-demo-003', source: 'demo' },
  ];

  for (const s of outdoorData) {
    await pool.query(
      `INSERT INTO outdoor_sessions (qr_id, destination, session_status, session_id, source, client_created_at)
       VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '3 hours')`,
      [s.qr_id, s.dest ? String(s.dest) : null, s.session_status, s.session_id, s.source]
    );
  }

  // Keep sessionIds pointing to indoor for feedback linkage
  const sessionIds = indoorSessionIds;

  console.log('Seeding QR scans...');
  for (let marker of qrMarkerRows.rows) {
    await pool.query(
      'INSERT INTO qr_scans (qr_code, device_id, scan_time, resolved_node_id) VALUES ($1, $2, NOW() - INTERVAL \'1 hour\', $3)',
      [marker.marker_name, 'device-mac-01', marker.linked_node]
    );
    await pool.query(
      'INSERT INTO qr_scans (qr_code, device_id, scan_time, resolved_node_id) VALUES ($1, $2, NOW() - INTERVAL \'30 minutes\', $3)',
      [marker.marker_name, 'device-mac-02', marker.linked_node]
    );
  }

  console.log('Seeding feedback inbox & ratings...');
  await pool.query(
    'INSERT INTO feedback (type, message, rating, session_id, node_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
    ['general', 'The QR scan at Block B Ground Floor Entrance was extremely fast.', 5, null, bLobbyNode?.id, 'resolved']
  );
  await pool.query(
    'INSERT INTO feedback (type, message, rating, session_id, node_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
    ['route_issue', 'Direction arrows vanished when transitioning to Level 2 in Block B.', 2, sessionIds[2] || null, bResearchNode?.id, 'open']
  );
  await pool.query(
    'INSERT INTO feedback (type, message, rating, session_id, node_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
    ['rating', 'Smooth navigation layout between Block H and Block C!', 4, sessionIds[1] || null, cComputingNode?.id, 'open']
  );

  console.log('Seeding settings...');
  await pool.query(
    'INSERT INTO system_settings (category, settings_json) VALUES ($1, $2) ON CONFLICT (category) DO NOTHING',
    ['organization', JSON.stringify({ organization_name: 'AASTU RTC/RD Center', campus_label: 'AASTU Campus Hub', support_contact: 'support@aastu-rtc.edu.et', timezone: 'Africa/Nairobi' })]
  );
  await pool.query(
    'INSERT INTO system_settings (category, settings_json) VALUES ($1, $2) ON CONFLICT (category) DO NOTHING',
    ['sessions', JSON.stringify({ session_timeout: 15, sync_interval: 30, retention_period: 90, anonymous_id_policy: 'uuid_per_install' })]
  );
  await pool.query(
    'INSERT INTO system_settings (category, settings_json) VALUES ($1, $2) ON CONFLICT (category) DO NOTHING',
    ['security', JSON.stringify({ token_ttl: 60, password_rules: 'min_8_chars_digit_special', allowed_origins: ['http://localhost:3000'], inactive_user_handling: 'suspend_after_30_days' })]
  );

  console.log('Seeding access logs...');
  await pool.query("INSERT INTO access_logs (actor, action, target, role) VALUES ('admin@navar.local', 'Database Seed Loaded', 'System Configuration', 'admin')");
  await pool.query("INSERT INTO access_logs (actor, action, target, role) VALUES ('facility@navar.local', 'Viewed AR Marker Inventory', 'QR Anchors module', 'facility_manager')");
  await pool.query("INSERT INTO access_logs (actor, action, target, role) VALUES ('admin@navar.local', 'Assigned Role facility_manager', 'facility@navar.local', 'admin')");

  console.log('Database seeding successfully finished.');
}

main().catch(error => {
  console.error('Error during database seed:', error);
  process.exitCode = 1;
}).finally(() => pool.end());
