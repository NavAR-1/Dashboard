const asyncHandler = require('../asyncHandler');

function createOutdoorNavigationController(service) {
  return {
    // ── Read / analytics ─────────────────────────────────────────────────
    analytics:       asyncHandler(async (_req, res) => res.json(await service.analytics())),
    sessions:        asyncHandler(async (_req, res) => res.json(await service.sessions())),
    map:             asyncHandler(async (_req, res) => res.json(await service.map())),
    mapDestinations: asyncHandler(async (req, res) => res.json(await service.mapDestinations(req.query))),
    mapNodes:        asyncHandler(async (req, res) => res.json(await service.mapNodes(req.query))),
    mapNode:         asyncHandler(async (req, res) => res.json(await service.mapNode(req.params.id))),
    mapEdges:        asyncHandler(async (req, res) => res.json(await service.mapEdges(req.query))),
    route:           asyncHandler(async (req, res) => res.json(await service.route(req.query))),
    recentSearches:  asyncHandler(async (_req, res) => res.json(await service.recentSearches())),
    campusNodes:     asyncHandler(async (_req, res) => res.json(await service.campusNodes())),

    // ── Tracking proxy — no auth, outdoor mobile app writes here ─────────
    trackSessionStart:    asyncHandler(async (req, res) => res.status(201).json(await service.trackSessionStart(req.body))),
    trackSessionComplete: asyncHandler(async (req, res) => res.json(await service.trackSessionComplete(req.body))),
    trackPosition:        asyncHandler(async (req, res) => res.json(await service.trackPosition(req.body))),
    trackSearch:          asyncHandler(async (req, res) => res.json(await service.trackSearch(req.body))),
  };
}

module.exports = createOutdoorNavigationController;
