'use client';
import { useEffect, useState } from 'react';
import * as api from '../../lib/api';
import { tok, useFetch, Pill, PHead, Empty, Spin, Err, Btn, Input, Sel, FGrid, TTable, TD, MsgBox } from './shared';
import CampusHeatMap from '../CampusHeatMap';

export function OverviewPanel() {
  const { data, loading, error, reload } = useFetch(() => api.getDashboard(tok()));
  const { data: outdoorData, loading: outdoorLoading } = useFetch(() => api.getOutdoorAnalytics(tok()));
  useEffect(() => {
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <article className="actualPanel"><Spin /></article>;
  if (error) return <article className="actualPanel"><Err msg={error} reload={reload} /></article>;
  const { kpis = {}, floorData = {}, navigationUsage = [], popularNodes = [], systemStatus = [] } = data || {};
  const outdoorStats = outdoorData?.stats || {};
  const outdoorRecent = Array.isArray(outdoorData?.recent) ? outdoorData.recent : [];
  const outdoorSearches = Array.isArray(outdoorData?.searches) ? outdoorData.searches : [];
  const kpiDefs = [['Buildings', kpis.buildings, '#3b82f6', '#dbeafe'], ['Nodes', kpis.nodes, '#6d5dfc', '#ede9fe'], ['Floor Nodes', floorData.nodes, '#0f766e', '#ccfbf1'], ['Floor POIs', floorData.destinations, '#be123c', '#ffe4e6'], ['AR Anchors', floorData.anchors || kpis.markers, '#f59e0b', '#ffedd5'], ['Sessions', kpis.sessions, '#ef4444', '#fee2e2']];
  const outdoorKpis = [
    ['Outdoor Sessions', outdoorStats.total],
    ['Completed', outdoorStats.completed],
    ['Today', outdoorStats.today],
    ['GPS Positions', outdoorStats.positions],
    ['Searches', outdoorStats.searches],
    ['Completion', outdoorStats.completion != null ? `${outdoorStats.completion}%` : null]
  ];
  const maxReq = Math.max(...navigationUsage.map(d => d.route_requests || 0), 1);
  return (
    <>
      <div className="actualMetricGrid">
        {kpiDefs.map(([label, val, color, bg]) => (
          <article className="actualMetric" key={label}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, color, display: 'grid', placeItems: 'center', fontWeight: 900, marginBottom: 8, fontSize: 13 }}>{label[0]}</div>
            <small>{label}</small><strong>{val ?? '–'}</strong>
          </article>
        ))}
      </div>
      <article className="actualPanel">
        <PHead title="Outdoor Navigation Stats" action={<span>{outdoorLoading ? 'Loading' : 'AASTU Navigator'}</span>} />
        <div className="actualMetricGrid" style={{ padding: '0 20px 20px', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
          {outdoorKpis.map(([label, value]) => (
            <div key={label} style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: 14, background: '#fbfdff' }}>
              <small style={{ color: '#64748b', display: 'block', fontSize: 12 }}>{label}</small>
              <strong style={{ display: 'block', marginTop: 6, fontSize: 22 }}>{value ?? '-'}</strong>
            </div>
          ))}
        </div>
      </article>
      <div className="actualGrid">
        <article className="actualPanel">
          <PHead title="Weekly Navigation Traffic" />
          <div style={{ padding: '0 20px 20px', display: 'grid', gap: 10 }}>
            {navigationUsage.map(d => {
              const pct = Math.round(((d.route_requests || 0) / maxReq) * 100);
              return (
                <div key={d.label} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 46px', gap: 8, alignItems: 'center' }}>
                  <small style={{ color: '#94a3b8', fontSize: 11 }}>{d.label}</small>
                  <div style={{ height: 8, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#6d5dfc,#60a5fa)', borderRadius: 999 }} />
                  </div>
                  <small style={{ fontSize: 12, color: '#475569', textAlign: 'right' }}>{d.route_requests}</small>
                </div>
              );
            })}
          </div>
        </article>
        <article className="actualPanel">
          <PHead title="System Status" />
          <div style={{ padding: '0 20px 20px' }}>
            {systemStatus.map(s => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px #dcfce7', display: 'block', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                </div>
                <small style={{ color: '#64748b', fontSize: 12 }}>{s.status}</small>
              </div>
            ))}
          </div>
        </article>
      </div>
      {popularNodes.length > 0 && (
        <article className="actualPanel">
          <PHead title="Popular Destinations" count={popularNodes.length} />
          <div className="actualTable">
            {popularNodes.map(n => (
              <div key={n.id}><b>{n.node_name}</b><span>{n.visits} visits</span><Pill v={n.visits > 10 ? 'Popular' : 'Active'} /></div>
            ))}
          </div>
        </article>
      )}
      <div className="actualGrid">
        <article className="actualPanel">
          <PHead title="Recent Outdoor Sessions" count={outdoorRecent.length} />
          {outdoorLoading ? <Spin /> : outdoorRecent.length === 0 ? <Empty /> : (
            <TTable
              heads={['From', 'To', 'Length', 'Status']}
              rows={outdoorRecent.slice(0, 8)}
              renderRow={session => (
                <>
                  <TD><b>{session.from_name || '-'}</b></TD>
                  <TD muted>{session.to_name || '-'}</TD>
                  <TD>{session.route_length ? `${Math.round(session.route_length)}m` : '-'}</TD>
                  <TD><Pill v={Number(session.completed) === 1 || session.completed === true ? 'Successful' : 'Failed'} /></TD>
                </>
              )}
            />
          )}
        </article>
        <article className="actualPanel">
          <PHead title="Top Outdoor Searches" count={outdoorSearches.length} />
          {outdoorLoading ? <Spin /> : outdoorSearches.length === 0 ? <Empty /> : (
            <div className="actualTable">
              {outdoorSearches.slice(0, 8).map(search => (
                <div key={search.name}>
                  <b>{search.name}</b>
                  <span>{search.count || 0} searches</span>
                  <Pill v="Active" />
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </>
  );
}

export function HeatMapPanel() {
  const { data: dashboardData, loading } = useFetch(() => api.getDashboard(tok()));
  const blockHeat = dashboardData?.blockHeat || [];

  return (
    <article className="actualPanel" style={{ background: '#080d1a', borderColor: 'rgba(30,47,74,0.6)' }}>
      <PHead
        title="AASTU Campus — Passage Density Heat Map"
        action={
          <span style={{ fontSize: 12, color: '#4dc8ff' }}>
            {loading ? 'Loading…' : `${blockHeat.reduce((s, b) => s + (b.visit_count || 0), 0).toLocaleString()} total passages`}
          </span>
        }
      />
      {loading ? (
        <div style={{ padding: 40 }}><Spin /></div>
      ) : (
        <div style={{ padding: '0 20px 20px' }}>
          <CampusHeatMap blockHeat={blockHeat} />
        </div>
      )}
    </article>
  );
}


export function SessionsPanel({ scope = 'inside' }) {
  if (scope !== 'inside') return <OutdoorNavigationPanel />;
  const { data, loading, error, reload } = useFetch(() => api.getSessions(tok(), 'inside'), [scope]);
  const { data: dashboardData } = useFetch(() => api.getDashboard(tok()));
  const sessions = data?.sessions || [];
  const floorData = dashboardData?.floorData || {};

  useEffect(() => {
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const total     = sessions.length;
  const completed = sessions.filter(s => s.session_status === 'completed').length;
  const cancelled = sessions.filter(s => s.session_status === 'cancelled').length;
  const active    = sessions.filter(s => !s.session_status).length;
  const kpis = [
    ['Total Sessions', total],
    ['Completed', completed],
    ['In Progress', active],
    ['Cancelled', cancelled],
    ['AR Anchors', floorData.anchors],
    ['Floor POIs', floorData.destinations],
    ['Completion', total > 0 ? `${Math.round((completed / total) * 100)}%` : null],
  ];

  if (loading) return <article className="actualPanel"><Spin /></article>;
  if (error) return <article className="actualPanel"><Err msg={error} reload={reload} /></article>;

  return (
    <div className="actualPage">
      <div className="actualMetricGrid">
        {kpis.map(([label, value]) => (
          <article className="actualMetric" key={label}>
            <small>{label}</small>
            <strong>{value ?? '-'}</strong>
          </article>
        ))}
      </div>

      <article className="actualPanel">
        <PHead
          title="Inside Navigation Sessions"
          count={sessions.length}
          action={<Btn variant="secondary" onClick={reload}>Refresh</Btn>}
        />
        <p style={{ margin: '-8px 20px 16px', color: '#64748b', fontSize: 13 }}>
          Indoor movement from QR anchors through rooms, floors, facilities, and POIs.
        </p>
        {sessions.length === 0 ? <Empty /> : (
          <TTable
            heads={['QR ID', 'Destination', 'Status', 'Visited Nodes', 'Session ID', 'Created']}
            rows={sessions}
            renderRow={s => (<>
              <TD mono><b>{s.qr_id || s.ar_marker_name || '-'}</b></TD>
              <TD muted>{String(s.destination_name || s.destination || '-').slice(0, 32)}</TD>
              <TD><Pill v={s.session_status === 'completed' ? 'Successful' : s.session_status === 'cancelled' ? 'Cancelled' : 'In Progress'} /></TD>
              <TD center>{Array.isArray(s.visited_node_ids) ? s.visited_node_ids.length : 0}</TD>
              <TD mono muted>{s.session_id || `DB-${s.id}`}</TD>
              <TD muted>{s.client_created_at ? new Date(s.client_created_at).toLocaleString() : '–'}</TD>
            </>)}
          />
        )}
      </article>
    </div>
  );
}

export function SyncPanel() {
  const { data, loading, error, reload } = useFetch(() => api.getSyncs(tok()));
  const syncs = data?.syncs || [];
  return (
    <article className="actualPanel">
      <PHead title="Device Sync Log" count={syncs.length} />
      {loading ? <Spin /> : error ? <Err msg={error} reload={reload} /> : syncs.length === 0 ? <Empty /> : (
        <TTable
          heads={['Scope', 'Last Sync', 'Total Sessions', 'Completed']}
          rows={syncs}
          renderRow={s => (<>
            <TD><b>{s.session_scope || '-'}</b></TD>
            <TD muted>{s.last_sync_time ? new Date(s.last_sync_time).toLocaleString() : '–'}</TD>
            <TD center>{s.session_count}</TD>
            <TD center><Pill v={`${s.successful_count} ok`} /></TD>
          </>)}
        />
      )}
    </article>
  );
}

function SyncBadge({ syncInfo }) {
  if (!syncInfo) return null;
  const { externalAvailable, sessionsSynced, syncedAt } = syncInfo;
  const timeStr = syncedAt ? new Date(syncedAt).toLocaleTimeString() : '';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, padding: '2px 8px', borderRadius: 12,
      background: externalAvailable ? 'rgba(34,197,94,0.1)' : 'rgba(148,163,184,0.1)',
      border: `1px solid ${externalAvailable ? 'rgba(34,197,94,0.3)' : 'rgba(148,163,184,0.2)'}`,
      color: externalAvailable ? '#22c55e' : '#94a3b8'
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: externalAvailable ? '#22c55e' : '#94a3b8', display: 'inline-block' }} />
      {externalAvailable
        ? `External API live · ${sessionsSynced} synced${timeStr ? ' · ' + timeStr : ''}`
        : `DB only · external API offline${timeStr ? ' · ' + timeStr : ''}`}
    </span>
  );
}

function OutdoorNavigationPanel() {
  const { data, loading, error, reload } = useFetch(() => api.getOutdoorAnalytics(tok()));
  const { data: campusData }             = useFetch(() => api.getOutdoorCampusNodes(tok()));
  const stats        = data?.stats    || {};
  const syncInfo     = data?.syncInfo || null;
  const recent       = Array.isArray(data?.recent)        ? data.recent        : [];
  const destinations = Array.isArray(data?.destinations)  ? data.destinations  : [];
  const routes       = Array.isArray(data?.routes)        ? data.routes        : [];
  const searches     = Array.isArray(data?.searches)      ? data.searches      : [];
  const heatmap      = Array.isArray(data?.heatmap)       ? data.heatmap       : [];
  const campusNodes  = Array.isArray(campusData?.nodes)   ? campusData.nodes   : [];
  const kpis = [
    ['Total Sessions', stats.total],
    ['Completed',      stats.completed],
    ['Cancelled',      stats.cancelled],
    ['Today',          stats.today],
    ['GPS Positions',  stats.positions],
    ['Completion',     stats.completion != null ? `${stats.completion}%` : null]
  ];

  if (loading) return <article className="actualPanel"><Spin /></article>;
  if (error) {
    return (
      <article className="actualPanel">
        <PHead title="Outside Navigation" action={<SyncBadge syncInfo={{ externalAvailable: false }} />} />
        <Err msg={error} reload={reload} />
      </article>
    );
  }

  return (
    <div className="actualPage">
      <div style={{ marginBottom: 12 }}>
        <SyncBadge syncInfo={syncInfo} />
        {syncInfo?.errors?.length > 0 && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#f59e0b' }}>
            ⚠ {syncInfo.errors[0]}
          </span>
        )}
      </div>
      <div className="actualMetricGrid">
        {kpis.map(([label, value]) => (
          <article className="actualMetric" key={label}>
            <small>{label}</small>
            <strong>{value ?? '-'}</strong>
          </article>
        ))}
      </div>

      <article className="actualPanel">
        <PHead
          title="Recent Outdoor Sessions"
          count={recent.length}
          action={
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {data?.source === 'merged' ? '⟳ external + local' : '💾 local DB'}
              {heatmap.length > 0 ? ` · ${heatmap.length} heat pts` : ''}
            </span>
          }
        />
        {recent.length === 0 ? <Empty /> : (
          <TTable
            heads={['From', 'To', 'Route Length', 'Status', 'Started', 'Completed']}
            rows={recent}
            renderRow={session => (
              <>
                <TD><b>{session.from_name || '-'}</b></TD>
                <TD muted>{session.to_name || '-'}</TD>
                <TD>{session.route_length ? `${Math.round(session.route_length)}m` : '-'}</TD>
                <TD><Pill v={Number(session.completed) === 1 || session.completed === true || session.session_status === 'completed' ? 'Successful' : 'Failed'} /></TD>
                <TD muted>{session.started_at || session.client_created_at ? new Date(session.started_at || session.client_created_at).toLocaleString() : '-'}</TD>
                <TD muted>{session.completed_at ? new Date(session.completed_at).toLocaleString() : '-'}</TD>
              </>
            )}
          />
        )}
      </article>

      <div className="actualGrid">
        <article className="actualPanel">
          <PHead title="Top Destinations" count={destinations.length} />
          {destinations.length === 0 ? <Empty /> : (
            <div className="actualTable">
              {destinations.slice(0, 8).map(destination => (
                <div key={destination.id || destination.name}>
                  <b>{destination.name}</b>
                  <span>{destination.id || '-'}</span>
                  <Pill v={`${destination.visits || 0} visits`} />
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="actualPanel">
          <PHead title="Top Searches" count={searches.length} />
          {searches.length === 0 ? <Empty /> : (
            <div className="actualTable">
              {searches.slice(0, 8).map(search => (
                <div key={search.name}>
                  <b>{search.name}</b>
                  <span>{search.count || 0} searches</span>
                  <Pill v="Active" />
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="actualPanel">
        <PHead title="Top Outdoor Routes" count={routes.length} />
        {routes.length === 0 ? <Empty /> : (
          <TTable
            heads={['Start', 'Destination', 'Count']}
            rows={routes}
            renderRow={route => (
              <>
                <TD><b>{route.fromName || '-'}</b></TD>
                <TD muted>{route.toName || '-'}</TD>
                <TD center>{route.count || 0}</TD>
              </>
            )}
          />
        )}
      </article>

      {/* AASTU Campus Map Nodes — live from external API */}
      <article className="actualPanel">
        <PHead
          title="AASTU Campus Nodes"
          count={campusNodes.length}
          action={
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Live from outdoor nav API
            </span>
          }
        />
        {campusNodes.length === 0 ? (
          <p style={{ padding: '12px 20px', color: '#64748b', fontSize: 13 }}>
            No campus nodes found — check that the outdoor API is reachable.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8, padding: '0 20px 20px' }}>
            {campusNodes.map(node => (
              <div key={node.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{node.name}</span>
                  <span style={{ fontSize: 10, background: '#e2e8f0', color: '#475569', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{node.type}</span>
                </div>
                {node.id && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>ID: {node.id}</div>}
                {node.notes && <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, lineHeight: 1.4 }}>{node.notes}</div>}
                {node.lat && node.lng && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontFamily: 'monospace' }}>
                    {Number(node.lat).toFixed(5)}, {Number(node.lng).toFixed(5)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </article>

      {/* Tracking endpoint info for mobile app configuration */}
      <article className="actualPanel" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <PHead title="Outdoor Mobile App Connection" />
        <div style={{ padding: '0 20px 20px', fontSize: 13, color: '#166534' }}>
          <p style={{ marginBottom: 8 }}>
            The outdoor navigation mobile app should point to <strong>this backend</strong> for session tracking.
            All outdoor data is stored locally and forwarded to the external API.
          </p>
          <div style={{ background: '#dcfce7', borderRadius: 6, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 2 }}>
            <div><b>Base URL:</b> {typeof window !== 'undefined' ? window.location.origin.replace('3000','4000').replace('3001','4000') : 'http://localhost:4000'}</div>
            <div><b>POST</b> /api/outdoor/track/session/start</div>
            <div><b>POST</b> /api/outdoor/track/session/complete</div>
            <div><b>POST</b> /api/outdoor/track/position</div>
            <div><b>POST</b> /api/outdoor/track/search</div>
          </div>
          <p style={{ marginTop: 8, fontSize: 12, color: '#166534' }}>
            These endpoints mirror the external API format exactly — no changes needed on the mobile app except the base URL.
          </p>
        </div>
      </article>
    </div>
  );
}
