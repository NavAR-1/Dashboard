const { getFloorDataSummary } = require('./floorDataService');

function createDashboardService(repo){
  return {
    async getDashboard(){
      const [kpis, navigationUsage, popularNodes, heatPoints, blockHeat] = await Promise.all([repo.dashboardCounts(), repo.usageSeries(), repo.popularNodes(), repo.heatPoints(), repo.blockHeatData()]);
      const floorData = getFloorDataSummary();
      return {
        kpis: { ...kpis, floor_anchors: floorData.anchors, floor_pois: floorData.destinations, floor_nodes: floorData.nodes },
        floorData,
        navigationUsage,
        popularNodes,
        heatPoints,
        blockHeat,
        systemStatus:[
          { name:'API Server', status:'Operational' },
          { name:'PostgreSQL', status:'Connected' },
          { name:'PostGIS', status:'Geography enabled' },
          { name:'Unity Mobile API', status:'Ready' }
        ]
      };
    },
    listFeedback: (type) => repo.listFeedback(type),
    updateFeedbackStatus: (id, status) => repo.updateFeedbackStatus(id, status),
    getSettings: () => repo.getSettings(),
    getSettingsByCategory: (category) => repo.getSettingsByCategory(category),
    updateSettingsByCategory: (category, json) => repo.updateSettingsByCategory(category, json)
  };
}
module.exports = createDashboardService;
