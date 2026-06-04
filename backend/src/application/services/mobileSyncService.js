const { integer, number, text } = require('../../domain/validators');

function normalizeSessionScope(input){
  const raw = input.session_scope || input.navigation_scope || input.scope || 'inside';
  return String(raw).toLowerCase().includes('outside') ? 'outside' : 'inside';
}

function nullableInteger(value, field){
  if(value === undefined || value === null || value === '') return null;
  return integer(Number(value), field);
}

function nullableText(value){
  if(value === undefined || value === null || value === '') return null;
  return String(value).trim();
}

function normalizeVisitedNodeIds(input){
  const raw = input.visited_node_ids || input.visitedNodeIds || [];
  return Array.isArray(raw) ? raw.map(item => integer(Number(item), 'visited_node_ids')).filter(Number.isInteger) : [];
}

function sessionAnchorId(input){
  return input.qr_id || input.qrId || input.qrID || input.ar_id || input.arId || input.arID || null;
}

function clientSessionId(input){
  return input.session_id || input.sessionId || input.client_session_id || input.clientSessionId || null;
}

function destinationNodeId(input){
  return input.destination_node_id || input.destinationNodeId || input.destinationNodeID || input.destination || input.end_node || input.endNode || null;
}

// Return only the fields the mobile needs
function sanitize(row){
  if(!row) return null;
  return {
    session_id:       row.session_id,
    qr_id:            row.qr_id,
    destination_node_id: row.destination || null,
    session_status:   row.session_status || null,
    visited_node_ids: row.visited_node_ids || [],
    session_scope:    row.session_scope,
    created_at:       row.client_created_at,
    distance_meters:  row.distance_meters !== null && row.distance_meters !== undefined ? Number(row.distance_meters) : null
  };
}

function sessionArray(input){
  if(Array.isArray(input)) return input;
  if(Array.isArray(input.sessions)) return input.sessions;
  return [input];
}

function createMobileSyncService(repo){
  return {

    async bootstrap(){
      const [buildings, nodes, routes, markers] = await Promise.all([
        repo.listBuildings(), repo.listNodes(), repo.listRoutes(), repo.listMarkers()
      ]);
      return { buildings, nodes, routes, markers, server_time: new Date().toISOString() };
    },

    // POST /mobile/navigation-sessions/start
    // Payload per session: { session_id, qr_id, destination_node_id?, started_at }
    async startSessions(input){
      const items = sessionArray(input);
      const saved = [];
      for(const item of items){
        const clientId = clientSessionId(item);
        // Mobile = ALWAYS indoor → writes directly to indoor_sessions
        const payload = {
          qr_id:             text(sessionAnchorId(item), 'qr_id', 120),
          destination:       nullableText(destinationNodeId(item)),
          session_status:    null,
          visited_node_ids:  [],
          client_created_at: item.started_at || item.client_created_at || null,
        };
        const row = await (clientId
          ? repo.upsertIndoorSessionByClientId(clientId, payload)
          : repo.createIndoorSession(payload)
        );
        saved.push(sanitize(row));
      }
      return saved;
    },

    // POST /mobile/navigation-sessions/end
    // Payload per session: { session_id, qr_id, visited_node_ids, destination_node_id?, ended_at? }
    async endSessions(input){
      const items = sessionArray(input);
      const saved = [];
      for(const item of items){
        const clientId = clientSessionId(item);
        const payload = {
          qr_id:             sessionAnchorId(item),
          destination:       nullableText(destinationNodeId(item)),
          session_status:    'completed',
          visited_node_ids:  normalizeVisitedNodeIds(item),
          client_created_at: item.ended_at || item.client_created_at || null,
        };
        const row = await (clientId
          ? repo.upsertIndoorSessionByClientId(clientId, payload)
          : repo.createIndoorSession(payload)
        );
        saved.push(sanitize(row));
      }
      return saved;
    },

    // POST /mobile/navigation-sessions/cancel
    // Payload per session: { session_id, qr_id, cancelled_at? }
    async cancelSessions(input){
      const items = sessionArray(input);
      const saved = [];
      for(const item of items){
        const clientId = clientSessionId(item);
        const payload = {
          qr_id:             sessionAnchorId(item),
          destination:       nullableText(destinationNodeId(item)),
          session_status:    'cancelled',
          visited_node_ids:  normalizeVisitedNodeIds(item),
          client_created_at: item.cancelled_at || item.canceled_at || item.client_created_at || null,
        };
        const row = await (clientId
          ? repo.upsertIndoorSessionByClientId(clientId, payload)
          : repo.createIndoorSession(payload)
        );
        saved.push(sanitize(row));
      }
      return saved;
    },

    // POST /mobile/sync — bulk offline upload (all mobile sessions = indoor)
    async sync(input){
      const items = sessionArray(input);
      const saved = [];
      for(const item of items){
        const clientId = clientSessionId(item);
        const statusRaw = String(item.session_status || item.status || '').toLowerCase();
        const sessionStatus = statusRaw.includes('cancel') || statusRaw.includes('fail')     ? 'cancelled'
                            : statusRaw.includes('complete') || statusRaw.includes('end')   ? 'completed'
                            : null;
        const payload = {
          qr_id:             sessionAnchorId(item),
          destination:       nullableText(destinationNodeId(item)),
          session_status:    sessionStatus,
          visited_node_ids:  normalizeVisitedNodeIds(item),
          client_created_at: item.started_at || item.ended_at || item.client_created_at || null,
        };
        const row = await (clientId
          ? repo.upsertIndoorSessionByClientId(clientId, payload)
          : repo.createIndoorSession(payload)
        );
        if(row) saved.push(sanitize(row));
      }
      return { accepted: saved.length, rejected: 0, sessions: saved, server_time: new Date().toISOString() };
    },

    // Legacy: POST /mobile/navigation-sessions (kept for backward compat)
    async saveSession(input){
      return this.sync(input);
    },

    async nearestNode(input){
      return repo.nearestNode(number(input.latitude, 'latitude'), number(input.longitude, 'longitude'));
    },

    // Mobile sessions panel always shows indoor_sessions only
    listSessions: (filters = {}) => repo.listIndoorSessions(filters),
    listSyncs:    ()             => repo.listIndoorSyncs(),

    createFeedback: input => repo.createFeedback({
      type:       'feedback',
      chips:      Array.isArray(input.chips) ? input.chips.map(c => String(c)).filter(Boolean) : [],
      message:    input.comment || input.message || null,
      rating:     input.rating ? integer(Number(input.rating), 'rating') : null,
      // session_id may be a client UUID string or a DB integer — repo resolves it
      session_id: input.session_id || null,
      node_id:    null
    })
  };
}

module.exports = createMobileSyncService;
