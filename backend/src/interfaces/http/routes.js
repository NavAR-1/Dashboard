const express = require('express');
const { requireAdmin, requirePermission } = require('./middleware/authMiddleware');
function createRoutes(controllers){
  const router = express.Router();
  const { authController, catalogController, dashboardController, mobileController, navigationController, accessControlController, sidebarController, outdoorNavigationController } = controllers;
  router.post('/auth/login', authController.login);
  router.get('/auth/me', requireAdmin, authController.me);
  router.get('/admin/sidebar', requireAdmin, sidebarController.getSidebar);
  router.get('/buildings', requirePermission('facilities.read'), catalogController.listBuildings);
  router.post('/buildings', requirePermission('facilities.create'), catalogController.createBuilding);
  router.patch('/buildings/:id/status', requirePermission('facilities.status'), catalogController.updateBuildingStatus);
  router.get('/navigation-nodes', requirePermission('maps.read'), catalogController.listNodes);
  router.get('/points-of-interest', requirePermission('facilities.read'), catalogController.listPois);
  router.post('/navigation-nodes', requirePermission('maps.create'), catalogController.createNode);
  router.get('/routes', requirePermission('routes.read'), catalogController.listRoutes);
  router.post('/routes', requirePermission('routes.create'), catalogController.createRoute);
  router.get('/ar-markers', requirePermission('qr_anchors.read'), catalogController.listMarkers);
  router.post('/ar-markers', requirePermission('qr_anchors.create'), catalogController.createMarker);
  router.get('/admin/dashboard', requirePermission('dashboard.read'), dashboardController.getDashboard);
  router.get('/navigation/path', requirePermission('maps.read'), navigationController.findPath);
  router.get('/navigation/nearest-node', requirePermission('maps.read'), navigationController.nearestNode);
  router.get('/access-control', requirePermission('access_control.read'), accessControlController.overview);
  router.post('/access-control/roles', requirePermission('access_control.create'), accessControlController.createRole);
  router.put('/access-control/roles/:id', requirePermission('access_control.update'), accessControlController.updateRole);
  router.delete('/access-control/roles/:id', requirePermission('access_control.delete'), accessControlController.deleteRole);
  router.patch('/access-control/users/:id/role', requirePermission('access_control.assign'), accessControlController.assignUserRole);
  router.post('/access-control/users', requirePermission('access_control.create'), accessControlController.createUser);
  router.put('/access-control/users/:id', requirePermission('access_control.update'), accessControlController.updateUser);
  router.delete('/access-control/users/:id', requirePermission('access_control.delete'), accessControlController.deleteUser);
  router.post('/access-control/modules', requirePermission('access_control.create'), accessControlController.createModule);
  router.put('/access-control/modules/:id', requirePermission('access_control.update'), accessControlController.updateModule);
  router.delete('/access-control/modules/:id', requirePermission('access_control.delete'), accessControlController.deleteModule);
  router.get('/access-control/logs', requirePermission('access_control.read'), accessControlController.listAccessLogs);
  router.post('/access-control/logs', requireAdmin, accessControlController.createAccessLog);

  router.get('/mobile/navigation-sessions', requirePermission('dashboard.read'), mobileController.listSessions);
  router.get('/mobile/sync', requirePermission('dashboard.read'), mobileController.listSyncs);
  router.get('/mobile/bootstrap', mobileController.bootstrap);
  router.post('/mobile/navigation-sessions/start', mobileController.startSessions);
  router.post('/mobile/navigation-sessions/end', mobileController.endSessions);
  router.post('/mobile/navigation-sessions/cancel', mobileController.cancelSessions);
  router.post('/mobile/navigation-sessions', mobileController.saveSession);
  router.post('/mobile/sync', mobileController.sync);
  router.get('/mobile/nearest-node', mobileController.nearestNode);
  router.post('/mobile/feedback', mobileController.createFeedback);

  router.get('/outdoor/analytics', requirePermission('dashboard.read'), outdoorNavigationController.analytics);
  router.get('/outdoor/sessions', requirePermission('dashboard.read'), outdoorNavigationController.sessions);
  router.get('/outdoor/map', requirePermission('maps.read'), outdoorNavigationController.map);
  router.get('/outdoor/map/destinations', requirePermission('maps.read'), outdoorNavigationController.mapDestinations);
  router.get('/outdoor/map/nodes', requirePermission('maps.read'), outdoorNavigationController.mapNodes);
  router.get('/outdoor/map/nodes/:id', requirePermission('maps.read'), outdoorNavigationController.mapNode);
  router.get('/outdoor/map/edges', requirePermission('maps.read'), outdoorNavigationController.mapEdges);
  router.get('/outdoor/route', requirePermission('routes.read'), outdoorNavigationController.route);
  router.get('/outdoor/recent-searches', requirePermission('dashboard.read'), outdoorNavigationController.recentSearches);
  router.get('/outdoor/campus-nodes', requirePermission('maps.read'), outdoorNavigationController.campusNodes);

  // ── Outdoor tracking proxy — NO auth required ─────────────────────────
  // The outdoor mobile app should set its base URL to THIS backend.
  // Data is stored locally in outdoor_sessions AND forwarded to the external API.
  router.post('/outdoor/track/session/start',    outdoorNavigationController.trackSessionStart);
  router.post('/outdoor/track/session/complete', outdoorNavigationController.trackSessionComplete);
  router.post('/outdoor/track/position',         outdoorNavigationController.trackPosition);
  router.post('/outdoor/track/search',           outdoorNavigationController.trackSearch);

  router.get('/admin/qr-scans', requirePermission('qr_anchors.read'), catalogController.listQrScans);
  router.get('/poi-categories', requirePermission('facilities.read'), catalogController.listPoiCategories);
  router.post('/poi-categories', requirePermission('facilities.create'), catalogController.createPoiCategory);
  router.patch('/points-of-interest/:id/visibility', requirePermission('facilities.update'), catalogController.patchPoiVisibility);
  router.get('/admin/accessibility', requirePermission('facilities.read'), catalogController.getAccessibilityOverview);

  router.get('/admin/feedback', requirePermission('feedback.read'), dashboardController.listFeedback);
  router.get('/admin/feedback/ratings', requirePermission('feedback.read'), dashboardController.listRatings);
  router.patch('/admin/feedback/:id/status', requirePermission('feedback.update'), dashboardController.updateFeedbackStatus);

  router.get('/admin/settings', requirePermission('settings.read'), dashboardController.getSettings);
  router.get('/admin/settings/:category', requirePermission('settings.read'), dashboardController.getSettingsByCategory);
  router.put('/admin/settings/:category', requirePermission('settings.update'), dashboardController.updateSettingsByCategory);

  return router;
}
module.exports = createRoutes;
