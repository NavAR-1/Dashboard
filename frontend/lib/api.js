export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function apiFetch(path, token, options = {}) {
  const res = await fetch(API_URL + '/api' + path, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = res.status === 403
      ? (data.error || 'Permission denied')
      : (data.error || `Request failed (${res.status})`);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const getSidebar       = (token)              => apiFetch('/admin/sidebar', token);
export const getDashboard     = (token)              => apiFetch('/admin/dashboard', token);
export const getSessions      = (token, scope)       => apiFetch('/mobile/navigation-sessions' + (scope ? `?scope=${scope}` : ''), token);
export const getOutdoorAnalytics   = (token)           => apiFetch('/outdoor/analytics', token);
export const getOutdoorCampusNodes = (token)           => apiFetch('/outdoor/campus-nodes', token);
export const getOutdoorSessions    = (token)           => apiFetch('/outdoor/sessions', token);
export const getOutdoorMap       = (token)           => apiFetch('/outdoor/map', token);
export const getOutdoorDestinations = (token, params = {}) => apiFetch('/outdoor/map/destinations' + query(params), token);
export const getOutdoorNodes     = (token, params = {}) => apiFetch('/outdoor/map/nodes' + query(params), token);
export const getOutdoorEdges     = (token, params = {}) => apiFetch('/outdoor/map/edges' + query(params), token);
export const getOutdoorRoute     = (token, params = {}) => apiFetch('/outdoor/route' + query(params), token);
export const getSyncs         = (token)              => apiFetch('/mobile/sync', token);
export const getQrScans       = (token)              => apiFetch('/admin/qr-scans', token);
export const getMarkers       = (token)              => apiFetch('/ar-markers', token);
export const createMarker     = (token, body)        => apiFetch('/ar-markers', token, { method: 'POST', body: JSON.stringify(body) });
export const getNodes         = (token)              => apiFetch('/navigation-nodes', token);
export const getPois          = (token)              => apiFetch('/points-of-interest', token);
export const patchPoiVisibility = (token, id, body) => apiFetch(`/points-of-interest/${id}/visibility`, token, { method: 'PATCH', body: JSON.stringify(body) });
export const getPoiCategories = (token)              => apiFetch('/poi-categories', token);
export const createPoiCategory = (token, body)      => apiFetch('/poi-categories', token, { method: 'POST', body: JSON.stringify(body) });
export const getAccessibility = (token)              => apiFetch('/admin/accessibility', token);
export const getBuildings     = (token)              => apiFetch('/buildings', token);
export const createBuilding   = (token, body)        => apiFetch('/buildings', token, { method: 'POST', body: JSON.stringify(body) });
export const updateBuildingStatus = (token, id, status) => apiFetch(`/buildings/${id}/status`, token, { method: 'PATCH', body: JSON.stringify({ status }) });
export const getAccessControl = (token)              => apiFetch('/access-control', token);
export const createRole       = (token, body)        => apiFetch('/access-control/roles', token, { method: 'POST', body: JSON.stringify(body) });
export const updateRole       = (token, id, body)    => apiFetch(`/access-control/roles/${id}`, token, { method: 'PUT', body: JSON.stringify(body) });
export const deleteRole       = (token, id)          => apiFetch(`/access-control/roles/${id}`, token, { method: 'DELETE' });
export const createUser       = (token, body)        => apiFetch('/access-control/users', token, { method: 'POST', body: JSON.stringify(body) });
export const updateUser       = (token, id, body)    => apiFetch(`/access-control/users/${id}`, token, { method: 'PUT', body: JSON.stringify(body) });
export const deleteUser       = (token, id)          => apiFetch(`/access-control/users/${id}`, token, { method: 'DELETE' });
export const assignUserRole   = (token, uid, roleId) => apiFetch(`/access-control/users/${uid}/role`, token, { method: 'PATCH', body: JSON.stringify({ roleId }) });
export const getAccessLogs    = (token)              => apiFetch('/access-control/logs', token);
export const createAccessLog  = (token, body)        => apiFetch('/access-control/logs', token, { method: 'POST', body: JSON.stringify(body) });
export const getFeedback      = (token, type)        => apiFetch('/admin/feedback' + (type ? `?type=${type}` : ''), token);
export const getRatings       = (token)              => apiFetch('/admin/feedback/ratings', token);
export const updateFeedbackStatus = (token, id, status) => apiFetch(`/admin/feedback/${id}/status`, token, { method: 'PATCH', body: JSON.stringify({ status }) });
export const getSettings      = (token)              => apiFetch('/admin/settings', token);
export const getSettingsByCategory = (token, cat)   => apiFetch(`/admin/settings/${cat}`, token);
export const updateSettingsByCategory = (token, cat, body) => apiFetch(`/admin/settings/${cat}`, token, { method: 'PUT', body: JSON.stringify(body) });

function query(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') q.set(key, value);
  });
  const text = q.toString();
  return text ? `?${text}` : '';
}
