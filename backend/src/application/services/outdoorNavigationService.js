const env = require('../../config/env');
const createExternalFetchService = require('./externalFetchService');
const createDatabaseSyncService = require('./databaseSyncService');
const { normalizeOutdoorPayload, normalizeOutdoorStats } = require('./externalNormalizationService');

const ENDPOINTS = {
  stats: '/api/admin/stats',
  heatmap: '/api/admin/heatmap',
  destinations: '/api/admin/destinations',
  routes: '/api/admin/routes',
  recent: '/api/admin/recent',
  searches: '/api/admin/searches',
  map: '/api/map',
  mapDestinations: '/api/map/destinations',
  mapNodes: '/api/map/nodes',
  mapEdges: '/api/map/edges',
  route: '/api/route',
  recentSearches: '/api/recent-searches'
};

function toQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  }
  const text = query.toString();
  return text ? '?' + text : '';
}

function normalizeRecentSession(session) {
  if (!session) return null;
  return {
    id: session.session_id || session.id,
    device_id: 'outdoor-app',
    session_scope: 'outside',
    start_name: session.from_name,
    end_name: session.to_name,
    distance_meters: session.route_length,
    duration_seconds: null,
    success: Number(session.completed) === 1 || session.completed === true,
    recovery_count: 0,
    client_created_at: session.started_at,
    completed_at: session.completed_at
  };
}

function createOutdoorNavigationService(repo) {
  const fetchService = createExternalFetchService({ baseUrl: env.outdoorNavApiUrl, source: 'outdoor' });
  const syncService = createDatabaseSyncService(repo);

  function dataFromRows(rows) {
    return rows.map(row => row.data_json || {}).filter(Boolean);
  }

  async function rows(recordType, limit) {
    return repo.listSourceRecords(recordType, limit);
  }

  /**
   * Build the analytics response by merging two sources:
   *
   *  • External API  — fetched + synced to DB *before* this function runs
   *                    (sessions upserted, heatmap/destination rows stored in source_records)
   *  • Neon DB       — single source of truth that now contains both local data
   *                    and anything the external API provided
   *
   * Stats strategy
   * ──────────────
   *  total     = max(DB count, external reported total)
   *              ↑ external API may report a higher number if we haven't synced
   *                all historical sessions yet
   *  completed = DB count  (accurate for what we have)
   *  today     = DB count  (always accurate)
   *  completion= DB %      (computed from what we have)
   *  positions / searches  = external stats only (we don't track these locally)
   *
   * extra.syncInfo is provided by analytics() and tells how the sync went.
   */
  async function outdoorDbAnalytics(extra = {}) {
    const [statsRows, heatRows, destinationRows, routeRows, recentSessions, searchRows] = await Promise.all([
      rows('analytics_stats', 1),
      rows('heatmap_point', 500),
      rows('destination', 500),
      rows('route', 500),
      repo.listOutdoorSessions(),
      rows('search_term', 200)
    ]);

    // ── External API's own aggregate stats (may be empty if API unreachable) ──
    const externalStats = statsRows[0]?.data_json || {};
    const extTotal     = Number(externalStats.total)      || 0;
    const extCompleted = Number(externalStats.completed)  || 0;
    const extToday     = Number(externalStats.today)      || 0;

    // ── DB counts — always accurate for what has been synced ─────────────────
    const todayStr     = new Date().toDateString();
    const dbTotal      = recentSessions.length;
    const dbCompleted  = recentSessions.filter(s => s.session_status === 'completed').length;
    const dbCancelled  = recentSessions.filter(s => s.session_status === 'cancelled').length;
    const dbToday      = recentSessions.filter(s =>
      s.client_created_at && new Date(s.client_created_at).toDateString() === todayStr
    ).length;

    // ── Merge: take the higher count so we never under-report ────────────────
    const mergedTotal     = Math.max(dbTotal, extTotal);
    const mergedCompleted = dbTotal > 0 ? dbCompleted  : extCompleted;
    const mergedToday     = dbToday  > 0 ? dbToday     : extToday;
    const completion      = mergedTotal > 0
      ? Math.round((mergedCompleted / mergedTotal) * 100)
      : (externalStats.completion != null ? Number(externalStats.completion) : null);

    const stats = {
      total:      mergedTotal     || null,
      completed:  mergedCompleted || null,
      cancelled:  dbCancelled     || null,
      today:      mergedToday     || null,
      positions:  externalStats.positions != null ? Number(externalStats.positions) : null,
      searches:   externalStats.searches  != null ? Number(externalStats.searches)  : null,
      completion
    };

    // ── Heatmap points (from external API, synced to source_records) ──────────
    const heatmap = heatRows.map(row => [
      Number(row.latitude  ?? row.data_json?.lat),
      Number(row.longitude ?? row.data_json?.lng),
      Number(row.data_json?.weight ?? row.data_json?.count ?? row.data_json?.intensity ?? 1)
    ]).filter(pt => pt.every(Number.isFinite));

    // ── Recent session list from DB (includes externally synced sessions) ─────
    const recent = recentSessions.map(s => ({
      from_name:      s.from_name  || s.qr_id      || null,  // human-readable start
      to_name:        s.to_name    || s.destination || null,  // human-readable end
      route_length:   s.distance_meters  || null,
      completed:      s.session_status === 'completed',
      session_status: s.session_status,
      started_at:     s.client_created_at,
      completed_at:   null,
      source:         s.source || 'mobile'
    }));

    return {
      configured: true,
      // 'merged' signals to the frontend that both sources contributed
      source: extra.syncInfo?.externalAvailable ? 'merged' : 'database',
      stats,
      heatmap,
      destinations: dataFromRows(destinationRows),
      routes:       dataFromRows(routeRows),
      recent,
      searches:     dataFromRows(searchRows),
      ...extra
    };
  }

  /**
   * Fetch from external API, sync new records into DB, return how many were synced.
   * Returns { synced: N } on success, { error: '...' } on failure.
   */
  async function fetchAndSync(path, recordType, operation, normalizer = data => normalizeOutdoorPayload(recordType, data)) {
    const data = await fetchService.fetchJson(path);
    const records = normalizer(data);
    let synced = 0;

    if (records.length) {
      await syncService.syncRecords(records, operation);
      synced = records.length;

      // For sessions: also write directly to navigation_sessions so they show up
      // in listSessions() and are included in stats immediately.
      // Outdoor sessions go directly to outdoor_sessions table — never mixed with indoor
      if (recordType === 'navigation_session') {
        for (const rec of records) {
          const item      = rec.data_json || {};
          const clientId  = rec.external_id || item.session_id
            || `outdoor-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const statusRaw = (item.completed === true || Number(item.completed) === 1)
            ? 'completed' : 'cancelled';
          await repo.upsertOutdoorSessionByClientId(clientId, {
            session_id:       clientId,
            from_name:        item.from_name  || item.fromNode  || item.start_name || null,
            to_name:          item.to_name    || item.toNode    || item.end_name   || null,
            qr_id:            item.from_name  || null,
            destination:      item.to_name    || null,
            session_status:   statusRaw,
            visited_node_ids: [],
            client_created_at: item.started_at || item.created_at || null,
            distance_meters:  item.route_length || item.distance_meters || null,
            source:           'external_api'
          });
        }
      }
    } else {
      await syncService.log('outdoor', operation, recordType, null, 'empty', { path });
    }
    return { synced, raw: data };
  }

  /**
   * Wrapper: tries fetchAndSync, returns { ok, synced, error }.
   * Never throws — a failed external call is non-fatal.
   */
  async function refresh(path, recordType, operation, normalizer) {
    try {
      const { synced } = await fetchAndSync(path, recordType, operation, normalizer);
      return { ok: true, synced };
    } catch (error) {
      await syncService.log('outdoor', operation, recordType, null, 'error', { path, message: error.message });
      return { ok: false, error: error.message };
    }
  }

  return {
    async analytics() {
      const syncAt = new Date().toISOString();

      // Run all external syncs in parallel — failures are non-fatal
      const [statsR, heatR, destR, routeR, recentR, searchR] = await Promise.all([
        refresh(ENDPOINTS.stats,        'analytics_stats',   'outdoor.stats.fetch',        normalizeOutdoorStats),
        refresh(ENDPOINTS.heatmap,      'heatmap_point',     'outdoor.heatmap.fetch'),
        refresh(ENDPOINTS.destinations, 'destination',       'outdoor.destinations.fetch'),
        refresh(ENDPOINTS.routes,       'route',             'outdoor.routes.fetch'),
        refresh(ENDPOINTS.recent,       'navigation_session','outdoor.recent.fetch'),
        refresh(ENDPOINTS.searches,     'search_term',       'outdoor.searches.fetch')
      ]);

      const externalAvailable = statsR.ok || recentR.ok; // API reachable if either succeeded
      const sessionsSynced    = recentR.synced || 0;
      const errors            = [statsR, heatR, destR, routeR, recentR, searchR]
        .filter(r => !r.ok).map(r => r.error).filter(Boolean);

      const syncInfo = {
        syncedAt:         syncAt,
        externalAvailable,
        sessionsSynced,                          // new sessions written to DB this request
        errors:           errors.length ? errors : undefined
      };

      return outdoorDbAnalytics({ syncInfo });
    },
    async sessions() {
      const { ok, synced, error } = await refresh(ENDPOINTS.recent, 'navigation_session', 'outdoor.sessions.fetch');
      const sessionsList = await repo.listOutdoorSessions();
      return {
        source: ok ? 'merged' : 'database',
        sessions: sessionsList.map(s => ({
          id:               s.session_id || s.id,
          device_id:        'outdoor-app',
          session_scope:    'outside',
          start_name:       s.qr_id,
          end_name:         s.destination_name || s.destination,
          distance_meters:  s.distance_meters,
          duration_seconds: null,
          success:          s.session_status === 'completed',
          session_status:   s.session_status,
          recovery_count:   0,
          client_created_at: s.client_created_at,
          completed_at:     null
        })),
        syncInfo: { externalAvailable: ok, sessionsSynced: synced || 0, error: error || undefined }
      };
    },
    async map() {
      const error = await refresh(ENDPOINTS.map, 'map_graph', 'outdoor.map.fetch', data => normalizeOutdoorPayload('map_graph', data));
      const maps = dataFromRows(await rows('map_graph', 10));
      return { source: 'database', map: maps[0] || null, ...(error ? { sync_error: error } : {}) };
    },
    async mapDestinations(query) {
      const error = await refresh(ENDPOINTS.mapDestinations + toQuery({ q: query.q, type: query.type }), 'destination', 'outdoor.map_destinations.fetch');
      const destinations = dataFromRows(await rows('destination', 500));
      return { source: 'database', destinations, ...(error ? { sync_error: error } : {}) };
    },
    async mapNodes(query) {
      const error = await refresh(ENDPOINTS.mapNodes + toQuery({ type: query.type }), 'map_node', 'outdoor.map_nodes.fetch');
      const nodes = dataFromRows(await rows('map_node', 500));
      return { source: 'database', nodes, ...(error ? { sync_error: error } : {}) };
    },
    async mapNode(id) {
      const error = await refresh('/api/map/nodes/' + encodeURIComponent(id), 'map_node', 'outdoor.map_node.fetch');
      const nodes = dataFromRows(await rows('map_node', 500));
      return { source: 'database', node: nodes.find(node => String(node.id) === String(id)) || null, ...(error ? { sync_error: error } : {}) };
    },
    async mapEdges(query) {
      const error = await refresh(ENDPOINTS.mapEdges + toQuery({ mode: query.mode }), 'map_edge', 'outdoor.map_edges.fetch');
      const edges = dataFromRows(await rows('map_edge', 500));
      return { source: 'database', edges, ...(error ? { sync_error: error } : {}) };
    },
    async route(query) {
      const recordType = 'computed_route';
      const error = await refresh(ENDPOINTS.route + toQuery({ fromId: query.fromId, toId: query.toId, mode: query.mode }), recordType, 'outdoor.route.fetch');
      const routes = dataFromRows(await rows(recordType, 100));
      return { source: 'database', route: routes[0] || null, ...(error ? { sync_error: error } : {}) };
    },
    async recentSearches() {
      const error = await refresh(ENDPOINTS.recentSearches, 'search_term', 'outdoor.recent_searches.fetch');
      const searches = dataFromRows(await rows('search_term', 200));
      return { source: 'database', searches, ...(error ? { sync_error: error } : {}) };
    },

    // ── Tracking proxy ────────────────────────────────────────────────────
    // The outdoor mobile app sends session events here.
    // We store them in outdoor_sessions AND forward to the external API.
    // This is the "write" path for outdoor data — the admin endpoints above
    // are the "read" path (sync from external → our DB → UI).

    async trackSessionStart(body) {
      // 1. Store locally in outdoor_sessions
      const session = await repo.createOutdoorSession({
        session_id:      body.sessionId || null,
        from_name:       body.fromName  || null,
        to_name:         body.toName    || null,
        session_status:  null,
        distance_meters: body.routeLength || null,
        source:          'mobile_app'
      });
      // 2. Forward to external API (best-effort, non-fatal)
      let externalId = null;
      try {
        const ext = await fetchService.postJson('/api/track/session/start', body);
        externalId = ext?.sessionId || null;
        // Update our record with the external ID if returned
        if (externalId && externalId !== body.sessionId) {
          await repo.upsertOutdoorSessionByClientId(externalId, {
            from_name: body.fromName, to_name: body.toName,
            distance_meters: body.routeLength, source: 'mobile_app'
          });
        }
      } catch (_err) { /* external API unavailable — our DB has the record */ }
      return { ok: true, sessionId: externalId || session.session_id || session.id };
    },

    async trackSessionComplete(body) {
      const sessionId = body.sessionId;
      // Update in our outdoor_sessions
      if (sessionId) {
        const existing = await repo.listOutdoorSessions();
        const row = existing.find(s => s.session_id === sessionId);
        if (row) await repo.updateOutdoorSession(row.id, { session_status: 'completed' });
      }
      // Forward to external API (best-effort)
      try { await fetchService.postJson('/api/track/session/complete', body); } catch (_) {}
      return { ok: true };
    },

    async trackPosition(body) {
      // Positions are fine-grained GPS points — store in source_records, forward to external
      await syncService.log('outdoor', 'position.track', 'gps_position', body.sessionId, 'insert',
        { lat: body.lat, lng: body.lng, step: body.step });
      try { await fetchService.postJson('/api/track/position', body); } catch (_) {}
      return { ok: true };
    },

    async trackSearch(body) {
      // Log locally then forward
      await syncService.log('outdoor', 'search.track', 'search_term', body.query, 'insert',
        { query: body.query, resultId: body.resultId, resultName: body.resultName });
      try { await fetchService.postJson('/api/track/search', body); } catch (_) {}
      return { ok: true };
    },

    // ── Campus graph (cached from external API) ────────────────────────────
    async campusNodes() {
      // Pull fresh nodes from external API and return
      let nodes = [];
      try { nodes = await fetchService.fetchJson('/api/map/nodes'); } catch (_) {}
      if (!Array.isArray(nodes)) nodes = [];
      return { nodes, count: nodes.length };
    }
  };
}

module.exports = createOutdoorNavigationService;
