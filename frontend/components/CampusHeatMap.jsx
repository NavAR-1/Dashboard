'use client';
/**
 * AASTU Campus Heat Map — People Passage Density
 *
 * Renders all 5 RTC blocks (B, C, F, G, H) as a top-down building footprint.
 * Each block is shaded transparent → dark-red based on how many navigation
 * sessions have passed through it.  Static display — colour deepens as
 * more session data accumulates in the database.
 */
import { useRef, useEffect, useCallback } from 'react';
import { CAMPUS_BLOCKS } from './campusData';

// ── Heat color: transparent white → deep red ──────────────────────────────────
// t = 0 → barely visible; t = 1 → deep crimson
const RED_STOPS = [
  [0,    [255, 240, 240, 0.06]],
  [0.18, [255, 160,  80, 0.42]],
  [0.42, [255,  50,  20, 0.68]],
  [0.68, [200,   0,   0, 0.82]],
  [1.0,  [130,   0,   0, 0.96]],
];

function redHeat(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RED_STOPS.length; i++) {
    const [t0, c0] = RED_STOPS[i - 1];
    const [t1, c1] = RED_STOPS[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0 || 1);
      return c0.map((v, j) => (j < 3 ? Math.round(v + f * (c1[j] - v)) : +(v + f * (c1[j] - v)).toFixed(2)));
    }
  }
  return RED_STOPS[RED_STOPS.length - 1][1];
}

function redCss(t, alphaOverride) {
  const [r, g, b, a] = redHeat(t);
  return `rgba(${r},${g},${b},${alphaOverride ?? a})`;
}

// ── Canvas coordinate helpers ─────────────────────────────────────────────────
function scalePts(pts, sx, sy) {
  return pts.map(([x, y]) => [x * sx, y * sy]);
}

function polygonCentroid(pts) {
  let x = 0, y = 0;
  pts.forEach(([px, py]) => { x += px; y += py; });
  return [x / pts.length, y / pts.length];
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ── Main draw function ────────────────────────────────────────────────────────
function drawHeatMap(canvas, blockVisits, hoveredIdx) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const sx = W / 780, sy = H / 460;

  ctx.clearRect(0, 0, W, H);

  // ── Dark background
  ctx.fillStyle = '#080d1a';
  ctx.fillRect(0, 0, W, H);

  // ── Subtle grid
  ctx.strokeStyle = 'rgba(30,47,74,0.55)';
  ctx.lineWidth = 0.5;
  for (let gx = 0; gx < W; gx += 40 * sx) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (let gy = 0; gy < H; gy += 40 * sy) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  // ── Campus boundary dashed outline
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(102,87,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(14 * sx, 24 * sy, (760 - 14) * sx, (440 - 24) * sy);
  ctx.setLineDash([]);

  // ── Inter-block connectors (corridors)
  const corridors = [
    { x1: 215, y1: 148, x2: 215, y2: 205 },
    { x1: 558, y1: 148, x2: 558, y2: 248 },
    { x1: 215, y1: 298, x2: 215, y2: 328 },
    { x1: 558, y1: 268, x2: 558, y2: 328 },
  ];
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 7 * Math.min(sx, sy);
  corridors.forEach(c => {
    ctx.beginPath();
    ctx.moveTo(c.x1 * sx, c.y1 * sy);
    ctx.lineTo(c.x2 * sx, c.y2 * sy);
    ctx.stroke();
  });

  // ── Max visits for normalisation
  const maxVisits = Math.max(...Object.values(blockVisits), 1);

  // ── Draw each block
  CAMPUS_BLOCKS.forEach((block, bi) => {
    const pts = scalePts(block.shape, sx, sy);
    const visits = blockVisits[block.id] ?? 0;
    const t = visits / maxVisits;
    const isHovered = hoveredIdx === bi;
    const [cx, cy] = polygonCentroid(pts);

    // Glow halo for visited blocks
    if (visits > 0) {
      const glowR = Math.max(...pts.map(([px, py]) => Math.hypot(px - cx, py - cy))) * 1.5;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      const [r, g, b] = redHeat(t);
      grd.addColorStop(0,   `rgba(${r},${g},${b},0.35)`);
      grd.addColorStop(0.6, `rgba(${r},${g},${b},0.10)`);
      grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      pts.forEach(([px, py], pi) => pi === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
      ctx.fill();
    }

    // Block fill
    ctx.fillStyle = visits === 0
      ? 'rgba(20,30,50,0.55)'            // empty block: near-invisible dark fill
      : redCss(t, isHovered ? Math.min(redHeat(t)[3] + 0.15, 1) : undefined);
    ctx.beginPath();
    pts.forEach(([px, py], pi) => pi === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
    ctx.closePath();
    ctx.fill();

    // Block stroke
    if (isHovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
    } else if (visits > 0) {
      const [r, g, b] = redHeat(t);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.80)`;
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = 'rgba(77,200,255,0.25)';
      ctx.lineWidth = 1;
    }
    ctx.beginPath();
    pts.forEach(([px, py], pi) => pi === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
    ctx.closePath();
    ctx.stroke();

    // Block label (ID + name)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 8;
    const bright = t > 0.45;
    const labelColor = bright ? 'rgba(255,255,255,0.95)' : 'rgba(200,220,255,0.88)';

    // Block ID — large
    ctx.font = `bold ${Math.round(22 * Math.min(sx, sy))}px Inter,sans-serif`;
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Block ${block.id}`, cx, cy - 12 * sy);

    // Short name
    const shortName = (block.label.split('\n')[1] || '').replace('Sust. Energy', 'Sust. En.').replace('HPC & Data', 'HPC').slice(0, 18);
    ctx.font = `${Math.round(9 * Math.min(sx, sy))}px Inter,sans-serif`;
    ctx.fillStyle = 'rgba(180,200,230,0.75)';
    ctx.fillText(shortName, cx, cy + 3 * sy);
    ctx.restore();

    // People count badge
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;

    const badgeY = cy + 18 * sy;
    const countStr = visits.toLocaleString();
    ctx.font = `bold ${Math.round(11 * Math.min(sx, sy))}px Inter,sans-serif`;
    const tw = ctx.measureText(countStr).width;
    const bw = tw + 14 * sx, bh = 16 * sy, bx = cx - bw / 2, by = badgeY - bh / 2, br = 4 * sy;

    // Badge background
    ctx.fillStyle = visits === 0
      ? 'rgba(30,47,74,0.75)'
      : redCss(Math.min(t + 0.15, 1), 0.88);
    ctx.beginPath();
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + bw - br, by);    ctx.arcTo(bx + bw, by,      bx + bw, by + br,      br);
    ctx.lineTo(bx + bw, by + bh - br); ctx.arcTo(bx + bw, by + bh, bx + bw - br, by + bh, br);
    ctx.lineTo(bx + br, by + bh);    ctx.arcTo(bx,      by + bh, bx,      by + bh - br, br);
    ctx.lineTo(bx, by + br);          ctx.arcTo(bx,      by,      bx + br, by,           br);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = visits === 0 ? 'rgba(100,140,200,0.7)' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(countStr, cx, badgeY);

    // "people" label below badge
    ctx.font = `${Math.round(7.5 * Math.min(sx, sy))}px Inter,sans-serif`;
    ctx.fillStyle = 'rgba(150,180,220,0.60)';
    ctx.fillText('passages', cx, badgeY + bh / 2 + 7 * sy);
    ctx.restore();
  });

  // ── Legend bar (bottom right) ─────────────────────────────────────────────
  const lgW = 130 * sx, lgH = 8 * sy;
  const lgX = W - lgW - 14 * sx, lgY = H - 28 * sy;

  const lgGrd = ctx.createLinearGradient(lgX, 0, lgX + lgW, 0);
  lgGrd.addColorStop(0,    'rgba(255,240,240,0.15)');
  lgGrd.addColorStop(0.35, 'rgba(255,100,40,0.60)');
  lgGrd.addColorStop(0.70, 'rgba(200,0,0,0.82)');
  lgGrd.addColorStop(1,    'rgba(130,0,0,0.96)');
  ctx.fillStyle = lgGrd;
  ctx.beginPath();
  ctx.roundRect(lgX, lgY, lgW, lgH, 3);
  ctx.fill();

  ctx.font = `${Math.round(8 * Math.min(sx, sy))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(150,180,220,0.70)';
  ctx.textAlign = 'left';  ctx.fillText('Low', lgX, lgY + lgH + 10 * sy);
  ctx.textAlign = 'right'; ctx.fillText('High', lgX + lgW, lgY + lgH + 10 * sy);
  ctx.textAlign = 'center'; ctx.fillText('Passage Intensity', lgX + lgW / 2, lgY - 5 * sy);

  // ── North arrow (top-right) ───────────────────────────────────────────────
  const ncx = W - 22 * sx, ncy = 26 * sy, nr = 13 * Math.min(sx, sy);
  ctx.fillStyle = '#4dc8ff';
  ctx.beginPath(); ctx.moveTo(ncx, ncy - nr); ctx.lineTo(ncx - 5 * sx, ncy + 6 * sy); ctx.lineTo(ncx, ncy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(77,200,255,0.3)';
  ctx.beginPath(); ctx.moveTo(ncx, ncy - nr); ctx.lineTo(ncx + 5 * sx, ncy + 6 * sy); ctx.lineTo(ncx, ncy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4dc8ff';
  ctx.font = `bold ${Math.round(9 * Math.min(sx, sy))}px Inter,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', ncx, ncy - nr - 6 * sy);

  // ── Floor label ───────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(77,200,255,0.45)';
  ctx.font = `bold ${Math.round(9 * Math.min(sx, sy))}px Inter,sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('AASTU RTC CAMPUS  ·  PASSAGE DENSITY  ·  ALL BLOCKS', 14 * sx, 10 * sy);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CampusHeatMap({ blockHeat = [] }) {
  const canvasRef   = useRef(null);
  const hoveredRef  = useRef(-1);

  // Build visit map { B: 42, C: 18, ... } from the API array
  const visitMap = {};
  blockHeat.forEach(row => {
    if (row.block_id) visitMap[row.block_id] = Number(row.visit_count) || 0;
  });

  const draw = useCallback(() => {
    drawHeatMap(canvasRef.current, visitMap, hoveredRef.current);
  }, [blockHeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hover interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sx = canvas.width / 780, sy = canvas.height / 460;

    function onMove(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width  / rect.width);
      const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
      let found = -1;
      for (let i = CAMPUS_BLOCKS.length - 1; i >= 0; i--) {
        if (pointInPolygon(mx, my, CAMPUS_BLOCKS[i].shape.map(([x, y]) => [x * sx, y * sy]))) { found = i; break; }
      }
      if (found !== hoveredRef.current) {
        hoveredRef.current = found;
        canvas.style.cursor = found >= 0 ? 'pointer' : 'crosshair';
        drawHeatMap(canvas, visitMap, found);
      }
    }

    function onLeave() {
      hoveredRef.current = -1;
      canvas.style.cursor = 'crosshair';
      drawHeatMap(canvas, visitMap, -1);
    }

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [blockHeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw whenever data changes
  useEffect(() => { draw(); }, [draw]);

  const totalPassages = Object.values(visitMap).reduce((a, b) => a + b, 0);
  const maxBlock = CAMPUS_BLOCKS.reduce((mx, b) => {
    const v = visitMap[b.id] ?? 0;
    return v > (visitMap[mx] ?? 0) ? b.id : mx;
  }, 'H');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8 }}>
        {CAMPUS_BLOCKS.map(b => {
          const v = visitMap[b.id] ?? 0;
          const t = v / Math.max(...Object.values(visitMap), 1);
          const [r, g, bl] = redHeat(t);
          return (
            <div key={b.id} style={{ background: '#0f172a', border: `1px solid rgba(${r},${g},${bl},${t > 0.05 ? 0.5 : 0.15})`, borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Block {b.id}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: v === 0 ? '#334155' : `rgb(${r},${g},${bl})` }}>{v.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: '#475569' }}>passages</div>
            </div>
          );
        })}
        <div style={{ background: '#0f172a', border: '1px solid rgba(77,200,255,0.2)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Total</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#4dc8ff' }}>{totalPassages.toLocaleString()}</div>
          <div style={{ fontSize: 10, color: '#475569' }}>all blocks</div>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ background: '#080d1a', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(30,47,74,0.8)' }}>
        <canvas
          ref={canvasRef}
          width={860}
          height={460}
          style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
        />
      </div>

      {/* Legend caption */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px' }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'linear-gradient(to right,rgba(255,240,240,0.15),rgba(255,80,20,0.70),rgba(130,0,0,0.96))' }} />
        <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>Low → High passage density</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'linear-gradient(to left,rgba(255,240,240,0.15),rgba(255,80,20,0.70),rgba(130,0,0,0.96))' }} />
      </div>
      <p style={{ margin: 0, fontSize: 11, color: '#475569', textAlign: 'center' }}>
        Colour deepens automatically as more navigation session data is recorded.
        Busiest block: <strong style={{ color: '#f87171' }}>Block {maxBlock}</strong>.
      </p>
    </div>
  );
}
