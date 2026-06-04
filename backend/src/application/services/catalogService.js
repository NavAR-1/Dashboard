const { integer, number, text } = require('../../domain/validators');
const { getFloorNodes, getFloorPois } = require('./floorDataService');

const POI_NODE_TYPES = ['room', 'lab', 'office', 'clinic', 'cafe', 'library', 'toilet', 'elevator', 'stairs', 'entrance', 'parking', 'POI', 'destination'];

function createCatalogService(repo){
  return {
    listBuildings: () => repo.listBuildings(),
    createBuilding: input => repo.createBuilding({ name:text(input.name,'name'), description:String(input.description || ''), longitude:number(input.longitude,'longitude'), latitude:number(input.latitude,'latitude') }),
    updateBuildingStatus: (id, input) => repo.updateBuildingStatus(integer(Number(id), 'id'), String(input.status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active'),
    async listNodes(){
      // Return only DB nodes — the frontend merges floor-file anchors on its own
      return repo.listNodes();
    },
    async listPois(){
      // Merge DB POI nodes + floor-file destinations
      const [dbNodes, floorPois] = await Promise.all([
        repo.listNodes(),
        Promise.resolve(getFloorPois())
      ]);
      // Pull nodes from DB that are POI types
      const dbPois = dbNodes
        .filter(n => POI_NODE_TYPES.includes(n.node_type))
        .map(n => ({
          id: n.id,
          poi_name: n.node_name,
          location_name: n.node_name,
          floor_label: n.floor_label || 'Ground',
          floor_id: null,
          node_type: n.node_type,
          entrance_node_ids: [],
          latitude: n.latitude,
          longitude: n.longitude,
          is_published: n.is_published,
          is_staff_only: n.is_staff_only,
          source: 'database'
        }));
      return [...dbPois, ...floorPois];
    },
    createNode: input => repo.createNode({ 
      node_name:text(input.node_name,'node_name'), 
      longitude:number(input.longitude,'longitude'), 
      latitude:number(input.latitude,'latitude'),
      floor_label: input.floor_label ? String(input.floor_label) : 'Ground',
      node_type: input.node_type ? String(input.node_type) : 'corridor',
      is_published: input.is_published !== false,
      is_staff_only: input.is_staff_only === true
    }),
    listRoutes: () => repo.listRoutes(),
    createRoute: input => repo.createRoute({ 
      start_node:integer(Number(input.start_node),'start_node'), 
      end_node:integer(Number(input.end_node),'end_node'), 
      distance:number(input.distance,'distance'),
      is_accessible: input.is_accessible !== false
    }),
    listMarkers: () => repo.listMarkers(),
    createMarker: input => repo.createMarker({ 
      marker_name:text(input.marker_name,'marker_name'), 
      model_path:String(input.model_path || ''), 
      longitude:number(input.longitude,'longitude'), 
      latitude:number(input.latitude,'latitude'),
      linked_node: input.linked_node ? integer(Number(input.linked_node), 'linked_node') : null,
      status: input.status ? String(input.status) : 'active'
    }),
    listQrScans: () => repo.listQrScans(),
    listPoiCategories: () => repo.listPoiCategories(),
    createPoiCategory: input => repo.createPoiCategory({
      name: text(input.name, 'name'),
      key: text(input.key, 'key'),
      description: String(input.description || ''),
      is_published: input.is_published !== false
    }),
    patchPoiVisibility: (id, input) => repo.patchPoiVisibility(integer(Number(id), 'id'), {
      is_published: input.is_published !== undefined ? !!input.is_published : undefined,
      is_staff_only: input.is_staff_only !== undefined ? !!input.is_staff_only : undefined
    }),
    getAccessibilityOverview: () => repo.getAccessibilityOverview()
  };
}
module.exports = createCatalogService;
