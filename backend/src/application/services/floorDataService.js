const fs = require('node:fs');
const path = require('node:path');

// Floor data directory: set FLOOR_DATA_DIR in .env for a custom location,
// otherwise defaults to <project-root>/floor-data/
const FLOOR_DATA_DIR = process.env.FLOOR_DATA_DIR ||
  path.join(__dirname, '..', '..', '..', '..', 'floor-data');

const FLOOR_FILES = [0, 1, 2, 3, 5].map(floor => ({
  floor,
  path: path.join(FLOOR_DATA_DIR, `Floor${floor}_Data.json`)
}));

let cache = null;

function readFloorFiles() {
  if (cache) return cache;
  const floors = FLOOR_FILES.map(file => {
    try {
      const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
      return {
        floor_id: file.floor,
        anchors: Array.isArray(data.anchors) ? data.anchors : [],
        destinations: Array.isArray(data.destinations) ? data.destinations : [],
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : []
      };
    } catch (_error) {
      return { floor_id: file.floor, anchors: [], destinations: [], nodes: [], edges: [] };
    }
  });
  cache = { floors };
  return cache;
}

function getFloorDataSummary() {
  const { floors } = readFloorFiles();
  const totals = floors.reduce((sum, floor) => ({
    anchors: sum.anchors + floor.anchors.length,
    destinations: sum.destinations + floor.destinations.length,
    nodes: sum.nodes + floor.nodes.length,
    edges: sum.edges + floor.edges.length
  }), { anchors: 0, destinations: 0, nodes: 0, edges: 0 });
  return { floors: floors.length, ...totals, floor_breakdown: floors.map(floor => ({
    floor_id: floor.floor_id,
    anchors: floor.anchors.length,
    destinations: floor.destinations.length,
    nodes: floor.nodes.length,
    edges: floor.edges.length
  })) };
}

function getFloorNodes() {
  return readFloorFiles().floors.flatMap(floor => floor.anchors.map(anchor => ({
    id: anchor.node_id,
    node_name: anchor.node_id,
    location_name: anchor.location_name,
    floor_label: `Floor ${anchor.floor_id}`,
    floor_id: anchor.floor_id,
    node_type: 'anchor',
    x: anchor.x,
    y: anchor.y,
    z: anchor.z,
    qr_id: anchor.qr_id,
    source: 'floor-data',
    is_published: true,
    is_staff_only: false
  })));
}

function getFloorPois() {
  return readFloorFiles().floors.flatMap(floor => floor.destinations.map(destination => ({
    id: destination.destination_id,
    poi_name: destination.name || destination.destination_id,
    location_name: destination.name || destination.destination_id,
    floor_label: `Floor ${destination.floor_id}`,
    floor_id: destination.floor_id,
    node_type: destination.category || 'POI',
    entrance_node_ids: destination.entrance_node_ids || [],
    source: 'floor-data',
    is_published: true,
    is_staff_only: false
  })));
}

module.exports = { getFloorDataSummary, getFloorNodes, getFloorPois };
