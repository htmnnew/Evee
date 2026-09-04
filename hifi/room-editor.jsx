// ─── room-editor.jsx ───
// Per-room furniture editor. Top-down 2D view of one room's interior, with
// drag-to-move / drag-to-resize furniture, plus a side panel for name, color,
// dimensions, vertical lift, height, deletion, and a "storage" toggle that
// surfaces the piece as a glowing storage area in RoomScene.
//
// Furniture coords are room-local (relative to the room's polygon-bbox origin),
// so anything added here automatically appears in the home dollhouse view too.
//
// All helpers prefixed re* to avoid collisions with editor.jsx's ed* family.

const RE_SNAP = 1 / 12; // 1 inch
const RE_PX_PER_FT = 26;

function reSnap(v, step = RE_SNAP) { return Math.round(v / step) * step; }
function reFmtFt(v) {
  const inches = Math.round(v * 12);
  const ft = Math.trunc(inches / 12);
  const inch = Math.abs(inches % 12);
  return inch === 0 ? `${ft}′` : `${ft}′ ${inch}″`;
}

// Feet + inches dual input. Feet arrow steps 1 ft, inches arrow steps 1 in;
// inches roll over into feet. Value is in feet (float).
const RE_FTIN_INPUT = { padding:'5px 6px', border:'1px solid rgba(58,42,30,.18)',
  borderRadius:6, background:'#fff', fontSize:13, width:46, textAlign:'right' };
function FtInField({ label, value, onChange, min = null }) {
  const totalIn = Math.round((value || 0) * 12);
  const ft = Math.trunc(totalIn / 12);
  const inch = Math.abs(totalIn % 12);
  function commit(nf, ni) {
    let v = (nf * 12 + ni) / 12;
    if (min != null) v = Math.max(min, v);
    onChange(reSnap(v));
  }
  return (
    <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:11 }}>
      <span style={{ opacity:.7 }}>{label}</span>
      <div style={{ display:'flex', gap:3, alignItems:'center' }}>
        <input type="number" value={ft} step={1}
          onChange={e => commit(parseInt(e.target.value || '0', 10), inch)}
          style={RE_FTIN_INPUT} />
        <span style={{ opacity:.5 }}>′</span>
        <input type="number" value={inch} step={1}
          onChange={e => commit(ft, parseInt(e.target.value || '0', 10))}
          style={RE_FTIN_INPUT} />
        <span style={{ opacity:.5 }}>″</span>
      </div>
      {/* Total inches — the unit you actually measure and cut in. */}
      <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:9,
        opacity:.45, marginTop:-2 }}>{totalIn}″</span>
    </label>
  );
}

// Iso viewBox for a room preview — mirrors SceneStage.roomBounds (rotated
// footprint, projected corners at floor + wall-top height).
function reIsoViewBox(room, rot = 0, pad = 18) {
  const bb = bbox(room.points);
  const fw = rot % 2 === 0 ? bb.w : bb.d;
  const fd = rot % 2 === 0 ? bb.d : bb.w;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [[0, 0], [fw, 0], [fw, fd], [0, fd]]) {
    for (const z of [-0.5, 9]) {
      const [sx, sy] = proj(x, y, z);
      if (sx < minX) minX = sx; if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx; if (sy > maxY) maxY = sy;
    }
  }
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
}

// Live iso preview of the room being edited. Reuses RoomScene, which reads the
// (live-mirrored) HOME_FURNITURE / STORAGE_AREAS globals, so it updates as you
// edit. Non-interactive (pointerEvents off).
function RoomIsoPreview({ room, height = 200 }) {
  const rot = room.viewRot || 0;
  const base = reIsoViewBox(room, rot);
  const bgColor = room.color || '#cdb98d';
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef(null);

  // Zoom about the centre, then offset by the pan. Pan is in viewBox units and
  // scaled by the zoom so a drag moves the same number of screen pixels however
  // far in you are.
  const w = base.w / zoom, h = base.h / zoom;
  const vb = {
    x: base.x + (base.w - w) / 2 + pan.x,
    y: base.y + (base.h - h) / 2 + pan.y,
    w, h,
  };

  function onDown(e) {
    drag.current = { x: e.clientX, y: e.clientY, pan };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }
  function onMove(e) {
    const d = drag.current;
    if (!d) return;
    const el = e.currentTarget.getBoundingClientRect();
    // px → viewBox units, so the drawing tracks the finger exactly.
    setPan({
      x: d.pan.x - (e.clientX - d.x) * (vb.w / el.width),
      y: d.pan.y - (e.clientY - d.y) * (vb.h / el.height),
    });
  }
  function onUp(e) {
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }
  const zoomed = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  return (
    <div>
      <div style={{ borderRadius:8, overflow:'hidden', position:'relative',
        border:'1px solid rgba(58,42,30,.15)', touchAction:'none',
        cursor: zoom > 1 ? 'grab' : 'default',
        background:`radial-gradient(ellipse at 50% 55%, ${shade(bgColor, +28)} 0%, ${shade(bgColor, -10)} 90%)` }}
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp}>
        <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" height={height}
          preserveAspectRatio="xMidYMid meet" style={{ display:'block', pointerEvents:'none' }}>
          <RoomScene roomId={room.id} rot={rot}
            hoverArea={null} selectedArea={null}
            onHoverArea={() => {}} onPickArea={() => {}} />
        </svg>
        {zoomed && (
          <button onClick={() => { setZoom(1); setPan({ x:0, y:0 }); }}
            style={{ position:'absolute', top:6, right:6, fontSize:10, padding:'2px 7px',
              borderRadius:6, cursor:'pointer', border:'1px solid rgba(58,42,30,.25)',
              background:'rgba(255,248,235,.9)', color:'#3a2a1e' }}>reset</button>
        )}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
        <span style={{ fontSize:10, opacity:.5 }}>zoom</span>
        <input type="range" min="1" max="4" step="0.05" value={zoom}
          onChange={e => setZoom(Number(e.target.value))} style={{ flex:1 }} />
        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:10, opacity:.55 }}>
          {zoom.toFixed(1)}×
        </span>
      </div>
    </div>
  );
}

// Iso thumbnail of a catalog entry, drawn by the same renderer as the rooms —
// so a saved cabinet looks in the rail exactly like it will once placed.
function CatalogThumb({ entry, height = 78 }) {
  const pad = 4;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [[0, 0], [entry.w, 0], [entry.w, entry.d], [0, entry.d]]) {
    for (const z of [0, entry.h || 1]) {
      const [sx, sy] = proj(x, y, z);
      if (sx < minX) minX = sx; if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx; if (sy > maxY) maxY = sy;
    }
  }
  const vb = `${minX - pad} ${minY - pad} ${(maxX - minX) + pad * 2} ${(maxY - minY) + pad * 2}`;
  return (
    <svg viewBox={vb} width="100%" height={height} preserveAspectRatio="xMidYMid meet"
      style={{ display:'block', pointerEvents:'none' }}>
      {isoDepthSort(entry.pieces, 0).map((p, i) => (
        <Box key={i} x={p.x} y={p.y} z={p.z || 0} w={p.w} d={p.d} h={p.h}
          color={p.color || '#a87850'} shape={p.shape} angle={p.angle || 0}
          stroke="rgba(60,40,20,0.4)" strokeWidth={0.5} />
      ))}
    </svg>
  );
}

// The catalog rail — saved assemblies, on the left of the room editor. Clicking
// a card drops that assembly into the room being edited. Collapsible because
// the canvas is the thing you're actually working in.
function CatalogRail({ catalog, collapsed, onToggle, onPlace, onRename, onDelete }) {
  if (collapsed) {
    return (
      <div style={{ width:30, flexShrink:0, borderRight:'1px solid rgba(58,42,30,.18)',
        background:'rgba(255,248,235,.6)', display:'flex', alignItems:'flex-start',
        justifyContent:'center', paddingTop:12, cursor:'pointer' }}
        onClick={onToggle} title="Show the catalog">
        <div style={{ writingMode:'vertical-rl', fontSize:10, fontWeight:700,
          letterSpacing:1, textTransform:'uppercase', opacity:.6 }}>
          Catalog ({catalog.length}) ›
        </div>
      </div>
    );
  }
  return (
    <div style={{ width:196, flexShrink:0, borderRight:'1px solid rgba(58,42,30,.18)',
      background:'rgba(255,248,235,.6)', display:'flex', flexDirection:'column', minHeight:0 }}>
      <div style={{ padding:'12px 12px 8px', display:'flex', alignItems:'center', gap:6,
        borderBottom:'1px solid rgba(58,42,30,.12)' }}>
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase',
          letterSpacing:.5, opacity:.6, flex:1 }}>Catalog</span>
        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:10, opacity:.45 }}>
          {catalog.length}
        </span>
        <button onClick={onToggle} title="Hide the catalog"
          style={{ border:'none', background:'none', cursor:'pointer', fontSize:12,
            color:'rgba(58,42,30,.6)', padding:0 }}>«</button>
      </div>
      <div style={{ flex:1, overflow:'auto', padding:10, display:'flex',
        flexDirection:'column', gap:10, minHeight:0 }}>
        {!catalog.length && (
          <div style={{ fontSize:11, opacity:.55, lineHeight:1.5 }}>
            Nothing saved yet. Select the pieces of something you've built —
            a cabinet, a desk and its legs — and press <b>Save to catalog</b>
            in the panel on the right. It'll show up here for every room.
          </div>
        )}
        {catalog.map(entry => (
          <div key={entry.id} style={{ position:'relative', borderRadius:8,
            border:'1px solid rgba(58,42,30,.18)', background:'#faf3e1', overflow:'hidden' }}>
            <div onClick={() => onPlace(entry)} title={`Add ${entry.name} to this room`}
              style={{ cursor:'pointer', padding:'8px 8px 6px' }}>
              <CatalogThumb entry={entry} />
              <div style={{ fontSize:11, fontWeight:600, marginTop:4, lineHeight:1.25,
                wordBreak:'break-word' }}>{entry.name}</div>
              <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:9,
                opacity:.5, marginTop:2 }}>
                {entry.pieces.length} pc · {reFmtFt(entry.w)} × {reFmtFt(entry.d)}
              </div>
            </div>
            <div style={{ display:'flex', borderTop:'1px solid rgba(58,42,30,.12)' }}>
              <button onClick={() => onRename(entry)} title="Rename"
                style={reRailBtn}>✎</button>
              <button onClick={() => onDelete(entry)} title="Remove from catalog"
                style={{ ...reRailBtn, borderLeft:'1px solid rgba(58,42,30,.12)' }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
const reRailBtn = { flex:1, border:'none', background:'none', cursor:'pointer',
  fontSize:11, padding:'4px 0', color:'rgba(58,42,30,.65)' };

// Recently used colours, newest first. Per device on purpose — this is working
// state, and keeping it on the plan would push a synced revision to every other
// device every time a colour is nudged.
const RE_RECENT_KEY = 'evee-recent-colors';
const RE_RECENT_MAX = 10;

function reRecentColors() {
  try { return JSON.parse(localStorage.getItem(RE_RECENT_KEY)) || []; } catch { return []; }
}
function rePushRecent(color) {
  if (!color) return reRecentColors();
  const next = [color, ...reRecentColors().filter(c => c !== color)].slice(0, RE_RECENT_MAX);
  try { localStorage.setItem(RE_RECENT_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// Pleasant default palette for new furniture.
const RE_DEFAULT_COLORS = [
  '#a87850', '#86583a', '#7a5836', '#849676',
  '#b65840', '#e0d2b6', '#c8a070', '#5a5048',
];

// ──────────────────────────────────────────────────────────────
// RoomCanvas — top-down SVG canvas for one room.
// ──────────────────────────────────────────────────────────────
// Effective draw-order key for a piece at view angle `rot` (0–3): the per-angle
// explicit order if set, else a legacy global zOrder, else stack height (z+h).
function reEffZ(it, rot = 0) {
  const o = it.zOrders && it.zOrders[rot];
  if (o != null) return o;
  if (it.zOrder != null) return it.zOrder;
  return (it.z || 0) + (it.h || 0);
}

// Members of a piece's group (or just itself if ungrouped).
function reGroupMembers(items, id) {
  const it = items.find(i => i.id === id);
  if (it && it.groupId) return items.filter(i => i.groupId === it.groupId).map(i => i.id);
  return [id];
}

// ─── Saved furniture (the catalog) ───────────────────────────────────────────
// An entry is one assembly — the twenty boxes that make up a flat-pack cabinet,
// say — kept with coordinates relative to its own bounding box so it can be
// dropped into any room. Ids are deliberately NOT stored: a piece's id is also
// its container id and the Notion join key, so a placed copy mints fresh ones.
// Reusing them would point two rooms' cabinets at one container, which is the
// orphaning gotcha in CLAUDE.md from the other direction. A storage piece
// travels with its container's label and face instead, and placing it creates
// a new, empty container.

// Dense 0-based draw ranks for the assembly's own pieces, per view angle — and
// only for angles the user actually arranged (some piece carries an explicit
// order there). The absolute numbers are slots in the *source* room's stack and
// mean nothing elsewhere, but the order among these pieces is exactly what
// makes a detailed model read correctly, so it travels. Untouched angles are
// left to geometry at placement, which is what they were using anyway.
function reRankByAngle(pieces) {
  const out = pieces.map(() => null);
  for (let rot = 0; rot < 4; rot++) {
    const touched = pieces.some(p => (p.zOrders && p.zOrders[rot] != null) || p.zOrder != null);
    if (!touched) continue;
    isoDepthSort(pieces, rot).forEach((p, idx) => {
      const i = pieces.indexOf(p);
      out[i] = { ...(out[i] || {}), [rot]: idx };
    });
  }
  return out;
}

// Build a catalog entry from a selection: `pieces` as they sit in the room,
// `areas` the room's storage-area list (for the containers' labels/faces).
function reCatalogEntry(name, pieces, areas) {
  const bounds = pieces.map(p => footprintBounds(p.x, p.y, p.w, p.d, p.angle || 0));
  const ox = Math.min(...bounds.map(b => b.x));
  const oy = Math.min(...bounds.map(b => b.y));
  const ranks = reRankByAngle(pieces);
  const round = v => +(+v).toFixed(4);
  return {
    id: 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || 'Saved furniture',
    w: round(Math.max(...bounds.map(b => b.x + b.w)) - ox),
    d: round(Math.max(...bounds.map(b => b.y + b.d)) - oy),
    h: round(Math.max(...pieces.map(p => (p.z || 0) + (p.h || 0)))),
    created: new Date().toISOString(),
    pieces: pieces.map((p, i) => {
      const out = { label: p.label || '', x: round(p.x - ox), y: round(p.y - oy),
        w: p.w, d: p.d, h: p.h, z: p.z || 0, color: p.color };
      if (p.shape) out.shape = p.shape;
      if (p.angle) out.angle = p.angle;
      if (ranks[i]) out.zOrders = ranks[i];
      if (p.storage) {
        const area = (areas || []).find(a => a.furniture === p.id);
        out.storage = true;
        out.areaLabel = (area && area.label) || p.label || 'Storage';
        out.face = (area && area.face) || 'front';
      }
      return out;
    }),
  };
}

// Materialise an entry into a room at room-local (x, y): fresh ids, one fresh
// groupId so it arrives as the unit it is, plus the storage areas its
// containers need. `existing` is the room's current furniture — the assembly's
// own ranks are lifted clear of whatever slots that room already uses, so its
// internal order survives while where it sits relative to the room's other
// pieces stays geometric (isoDepthSort only compares ranks when both pieces
// carry one) until the Order buttons say otherwise.
function rePlaceEntry(entry, x, y, existing) {
  const ts = Date.now().toString(36);
  const gid = 'g-' + ts;
  const base = {};
  for (let rot = 0; rot < 4; rot++) {
    let max = -1;
    (existing || []).forEach(it => {
      const o = (it.zOrders && it.zOrders[rot] != null) ? it.zOrders[rot] : it.zOrder;
      if (o != null && o > max) max = o;
    });
    base[rot] = max + 1;
  }
  const pieces = entry.pieces.map((p, i) => {
    const piece = {
      id: 'f-' + ts + i.toString(36) + Math.random().toString(36).slice(2, 5),
      label: p.label || 'New piece',
      x: reSnap(x + p.x), y: reSnap(y + p.y),
      w: p.w, d: p.d, h: p.h, z: p.z || 0, color: p.color, groupId: gid,
    };
    if (p.shape) piece.shape = p.shape;
    if (p.angle) piece.angle = p.angle;
    if (p.storage) piece.storage = true;
    if (p.zOrders) {
      piece.zOrders = {};
      Object.keys(p.zOrders).forEach(rot => { piece.zOrders[rot] = base[rot] + p.zOrders[rot]; });
    }
    return piece;
  });
  const areas = entry.pieces.map((p, i) => p.storage ? {
    id: pieces[i].id, label: p.areaLabel || p.label || 'Storage',
    furniture: pieces[i].id, face: p.face || 'front', items: 0,
  } : null).filter(Boolean);
  return { pieces, areas };
}

// Normalize wallOverrides to the per-angle shape `{ [rot]: { [edge]: bool } }`.
// Legacy flat entries (edge→bool, applied to every angle) are copied into all
// four rotations so the per-angle cycle behaves cleanly afterward; entries that
// are already per-angle pass through unchanged. Returns a fresh object.
function reMigrateWallOverrides(wo) {
  if (!wo) return {};
  const flat = {}, perRot = {};
  for (const k in wo) {
    if (typeof wo[k] === 'boolean') flat[k] = wo[k];
    else if (wo[k] && typeof wo[k] === 'object') perRot[k] = { ...wo[k] };
  }
  if (!Object.keys(flat).length) return perRot;          // nothing legacy → as-is
  const out = {};
  for (let rr = 0; rr < 4; rr++) out[rr] = { ...flat, ...(perRot[rr] || {}) };
  return out;
}

function RoomCanvas({ room, items, selectedIds, primaryId, onSelect, onClear,
                      onPatchItem, onMoveMany, onCycleWall, onSelectMany }) {
  const svgRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [marquee, setMarquee] = React.useState(null);
  const marqueeRef = React.useRef(null);
  function putMarquee(m) { marqueeRef.current = m; setMarquee(m); }

  const bb = bbox(room.points);
  // Room-local outline (origin at bbox top-left).
  const outline = room.points.map(p => ({ x: p.x - bb.x, y: p.y - bb.y }));
  const W = bb.w, D = bb.d;
  const PAD = 28;
  const canvasW = W * RE_PX_PER_FT + PAD * 2;
  const canvasH = D * RE_PX_PER_FT + PAD * 2;

  function ftFromEvent(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      fx: (e.clientX - rect.left - PAD) / RE_PX_PER_FT,
      fy: (e.clientY - rect.top  - PAD) / RE_PX_PER_FT,
    };
  }

  function onDownItem(e, item) {
    e.stopPropagation();
    if (e.shiftKey) { onSelect(item.id, true); return; }   // toggle in/out, no drag
    // Drag the whole current selection if this piece is already part of it;
    // otherwise select this piece's group and drag that.
    let ids;
    if (selectedIds.includes(item.id) && selectedIds.length > 1) {
      ids = selectedIds;
    } else {
      ids = reGroupMembers(items, item.id);
      onSelect(item.id, false);
    }
    const { fx, fy } = ftFromEvent(e);
    const orig = {};
    ids.forEach(id => { const it = items.find(x => x.id === id); if (it) orig[id] = { x: it.x, y: it.y }; });
    dragRef.current = { kind: 'moveMany', ids, startX: fx, startY: fy, orig };
  }
  function onDownHandle(e, item, corner) {
    e.stopPropagation();
    onSelect(item.id, false);
    const { fx, fy } = ftFromEvent(e);
    dragRef.current = { kind: 'resize', id: item.id, corner, startX: fx, startY: fy,
      orig: { x: item.x, y: item.y, w: item.w, d: item.d, angle: item.angle || 0 } };
  }
  // Marquee select. Starts on empty canvas — starting it on a piece would
  // steal that piece's drag — and catches anything it overlaps regardless of
  // draw order, which is the point: a desk leg tucked behind the desk top
  // cannot be clicked, but a rectangle drawn over it can reach it.
  function onDownCanvas(e) {
    const { fx, fy } = ftFromEvent(e);
    dragRef.current = { kind: 'marquee', startX: fx, startY: fy, additive: e.shiftKey };
    putMarquee({ x0: fx, y0: fy, x1: fx, y1: fy });
  }

  React.useEffect(() => {
    function onMove(e) {
      const d = dragRef.current;
      if (!d) return;
      const { fx, fy } = ftFromEvent(e);
      const dx = fx - d.startX, dy = fy - d.startY;
      if (d.kind === 'marquee') {
        putMarquee({ x0: d.startX, y0: d.startY, x1: fx, y1: fy });
        return;
      }
      if (d.kind === 'moveMany') {
        const updates = {};
        d.ids.forEach(id => { updates[id] = { x: reSnap(d.orig[id].x + dx), y: reSnap(d.orig[id].y + dy) }; });
        onMoveMany(updates);
      } else if (d.kind === 'resize') {
        // Resize happens in the piece's own frame: w/d are its unrotated
        // dimensions, so the pointer delta is un-rotated first and the grown
        // edge is held still by shifting the centre half the growth back along
        // the local axis. At angle 0 this is exactly the old anchor arithmetic.
        const ang = (d.orig.angle || 0) * Math.PI / 180;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const ldx = dx * cs + dy * sn, ldy = -dx * sn + dy * cs;
        const min = RE_SNAP; // 1 inch — the finest the grid snaps to
        let w = d.orig.w, depth = d.orig.d, sx = 0, sy = 0;
        if (d.corner.includes('e')) { w = Math.max(min, reSnap(d.orig.w + ldx));     sx =  (w - d.orig.w) / 2; }
        if (d.corner.includes('w')) { w = Math.max(min, reSnap(d.orig.w - ldx));     sx = -(w - d.orig.w) / 2; }
        if (d.corner.includes('s')) { depth = Math.max(min, reSnap(d.orig.d + ldy)); sy =  (depth - d.orig.d) / 2; }
        if (d.corner.includes('n')) { depth = Math.max(min, reSnap(d.orig.d - ldy)); sy = -(depth - d.orig.d) / 2; }
        const cx = d.orig.x + d.orig.w / 2 + sx * cs - sy * sn;
        const cy = d.orig.y + d.orig.d / 2 + sx * sn + sy * cs;
        onPatchItem(d.id, { x: reSnap(cx - w / 2), y: reSnap(cy - depth / 2), w, d: depth });
      }
    }
    function onUp() {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || d.kind !== 'marquee') return;
      const m = marqueeRef.current;   // read before clearing, not after
      putMarquee(null);
      // A tap with no meaningful drag is still "click empty space to deselect".
      if (!m || (Math.abs(m.x1 - m.x0) < 0.15 && Math.abs(m.y1 - m.y0) < 0.15)) {
        if (!d.additive) onClear();
        return;
      }
      const lo = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1) };
      const hi = { x: Math.max(m.x0, m.x1), y: Math.max(m.y0, m.y1) };
      // Touched, not enclosed: overlap is enough, so you can sweep across a
      // cluster without having to contain every piece of it. Angled pieces are
      // caught by the bounds of the footprint as it sits.
      const hit = items.filter(it => {
        const b = footprintBounds(it.x, it.y, it.w || 0, it.d || 0, it.angle || 0);
        return b.x < hi.x && b.x + b.w > lo.x && b.y < hi.y && b.y + b.d > lo.y;
      });
      if (hit.length && onSelectMany) onSelectMany(hit.map(it => it.id), d.additive);
      else if (!d.additive) onClear();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onPatchItem, onMoveMany, onSelectMany, onClear, items]);

  // Grid: 1ft minor, 5ft major.
  const grid = [];
  const maxX = Math.ceil(W), maxY = Math.ceil(D);
  for (let i = 0; i <= maxX; i++) {
    grid.push(<line key={'gx'+i} x1={i*RE_PX_PER_FT} y1={0} x2={i*RE_PX_PER_FT} y2={maxY*RE_PX_PER_FT}
      stroke="rgba(58,42,30,.14)" strokeWidth={i % 5 === 0 ? 0.7 : 0.3} />);
  }
  for (let i = 0; i <= maxY; i++) {
    grid.push(<line key={'gy'+i} x1={0} y1={i*RE_PX_PER_FT} x2={maxX*RE_PX_PER_FT} y2={i*RE_PX_PER_FT}
      stroke="rgba(58,42,30,.14)" strokeWidth={i % 5 === 0 ? 0.7 : 0.3} />);
  }

  const outlineStr = outline.map(p => `${p.x*RE_PX_PER_FT},${p.y*RE_PX_PER_FT}`).join(' ');

  // Per-edge wall state for the on-canvas toggles. Default state is the same
  // heuristic RoomScene uses: back-facing AND not shared with another room. The
  // back-facing test and the override are both evaluated at the room's *current*
  // view angle (viewRot), so the toggles reflect — and write — what shows from
  // that angle. `shared` is camera-independent (unrotated world geometry); only
  // `isBack` rotates. Edge index `i` is stable across rotations.
  const rot = room.viewRot || 0;
  const rotated = outline.map(pt => rotPoint(pt.x, pt.y, rot, W, D));
  const cRot = centroid(rotated);
  const others = APARTMENT.rooms.filter(r => r.id !== room.id && !!r.points);
  const wallEdges = outline.map((p, i) => {
    const next = outline[(i + 1) % outline.length];
    const mx = (p.x + next.x) / 2, my = (p.y + next.y) / 2;
    const dx = next.x - p.x, dy = next.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const wmx = mx + bb.x, wmy = my + bb.y;
    const EPS = 0.05;
    const a = { x: wmx + (dy / len) * EPS, y: wmy + (-dx / len) * EPS };
    const b = { x: wmx - (dy / len) * EPS, y: wmy - (-dx / len) * EPS };
    const outside = pointInPolygon(a, room.points) ? b : a;
    const rp = rotated[i], rnext = rotated[(i + 1) % outline.length];
    const isBack = (cRot.x + cRot.y) > ((rp.x + rnext.x) / 2 + (rp.y + rnext.y) / 2);
    const shared = others.some(or => pointInPolygon(outside, or.points));
    const autoOn = isBack && !shared;
    const override = wallOverrideFor(room, rot, i);
    const showWall = override === undefined ? autoOn : override;
    return { i, mx, my, autoOn, override, showWall };
  });

  return (
    <svg ref={svgRef} width={canvasW} height={canvasH} style={{ touchAction:'none' }}
      style={{ display:'block', background:'#faf3e1', borderRadius:8 }}
      onPointerDown={onDownCanvas}>
      <g transform={`translate(${PAD},${PAD})`}>
        {grid}
        <polygon points={outlineStr}
          fill={room.color || '#cdb98d'} fillOpacity={0.35}
          stroke="rgba(58,42,30,.55)" strokeWidth={1.5} strokeLinejoin="round" />

        {/* Per-edge wall overlay: thicker stroke where a wall is drawn in the
            iso room view; thin dashed where it isn't. */}
        {onCycleWall && wallEdges.map(({ i, showWall }) => {
          const p = outline[i];
          const next = outline[(i + 1) % outline.length];
          return (
            <line key={'we' + i}
              x1={p.x*RE_PX_PER_FT} y1={p.y*RE_PX_PER_FT}
              x2={next.x*RE_PX_PER_FT} y2={next.y*RE_PX_PER_FT}
              stroke={showWall ? '#3a2a1e' : 'rgba(58,42,30,.25)'}
              strokeWidth={showWall ? 4 : 1.5}
              strokeDasharray={showWall ? '0' : '4 3'}
              strokeLinecap="round"
              style={{ pointerEvents: 'none' }} />
          );
        })}

        {/* Edge midpoint buttons — cycle auto → on → off → auto. */}
        {onCycleWall && wallEdges.map(({ i, mx, my, autoOn, override, showWall }) => {
          const isAuto = override === undefined;
          const fill = showWall ? '#3a2a1e' : '#fff';
          const stroke = isAuto ? 'rgba(58,42,30,.4)' : '#c96442';
          const title = isAuto
            ? `Edge ${i + 1} · auto (${autoOn ? 'wall' : 'no wall'})`
            : `Edge ${i + 1} · forced ${override ? 'wall' : 'no wall'}`;
          return (
            <g key={'wt' + i} style={{ cursor:'pointer' }}
              onPointerDown={e => { e.stopPropagation(); onCycleWall(i); }}>
              <title>{title}</title>
              <circle cx={mx*RE_PX_PER_FT} cy={my*RE_PX_PER_FT} r={8}
                fill={fill} stroke={stroke} strokeWidth={isAuto ? 1.2 : 2} />
              {showWall && (
                <rect x={mx*RE_PX_PER_FT - 3} y={my*RE_PX_PER_FT - 4}
                  width={6} height={8} fill="#fff" rx={1} />
              )}
              {!isAuto && (
                <circle cx={mx*RE_PX_PER_FT + 6} cy={my*RE_PX_PER_FT - 6} r={2.5}
                  fill="#c96442" />
              )}
            </g>
          );
        })}

        {[...items].sort((a, b) => reEffZ(a, room.viewRot || 0) - reEffZ(b, room.viewRot || 0)).map(item => {
          const isSel = selectedIds.includes(item.id);
          const single = selectedIds.length === 1 && item.id === primaryId;
          const x = item.x * RE_PX_PER_FT;
          const y = item.y * RE_PX_PER_FT;
          const w = item.w * RE_PX_PER_FT;
          const h = item.d * RE_PX_PER_FT;
          const isCircle = item.shape === 'circle';
          // An angled piece is drawn — handles, label and all — inside a rotated
          // group about its own centre. SVG rotates clockwise with y down, the
          // same convention `angle` uses, and hit-testing follows the transform,
          // so clicks and drags need no un-rotating of their own.
          const spin = item.angle
            ? `rotate(${item.angle} ${x + w / 2} ${y + h / 2})` : undefined;
          return (
            <g key={item.id} transform={spin}>
              {isCircle ? (
                <ellipse cx={x + w/2} cy={y + h/2} rx={w/2} ry={h/2}
                  fill={item.color || '#a87850'} fillOpacity={0.85}
                  stroke={isSel ? '#c96442' : 'rgba(58,42,30,.5)'}
                  strokeWidth={isSel ? 2 : 1}
                  style={{ cursor:'move' }}
                  onPointerDown={e => onDownItem(e, item)} />
              ) : (
                <rect x={x} y={y} width={w} height={h}
                  fill={item.color || '#a87850'} fillOpacity={0.85}
                  stroke={isSel ? '#c96442' : 'rgba(58,42,30,.5)'}
                  strokeWidth={isSel ? 2 : 1}
                  style={{ cursor:'move' }}
                  onPointerDown={e => onDownItem(e, item)} />
              )}
              {item.storage && (isCircle ? (
                <ellipse cx={x + w/2} cy={y + h/2} rx={Math.max(0,w/2-2)} ry={Math.max(0,h/2-2)}
                  fill="none" stroke="#ffaa55" strokeWidth={1.2}
                  strokeDasharray="3 2" style={{ pointerEvents:'none' }} />
              ) : (
                <rect x={x+2} y={y+2} width={Math.max(0,w-4)} height={Math.max(0,h-4)}
                  fill="none" stroke="#ffaa55" strokeWidth={1.2}
                  strokeDasharray="3 2" style={{ pointerEvents:'none' }} />
              ))}
              {w > 28 && h > 14 && (
                <text x={x + w/2} y={y + h/2 + 3} textAnchor="middle"
                  fontSize={10} fontWeight={600} fill="rgba(58,42,30,.85)"
                  style={{ pointerEvents:'none' }}>
                  {item.label || item.id}
                </text>
              )}
              {/* Resize handles only when a single piece is selected. */}
              {single && ['nw','ne','sw','se'].map(c => {
                const hx = (c.includes('w') ? x : x + w) - 4;
                const hy = (c.includes('n') ? y : y + h) - 4;
                return (
                  <rect key={c} x={hx} y={hy} width={8} height={8}
                    fill="#fff" stroke="#c96442" strokeWidth={1.5}
                    style={{ cursor: (c==='nw'||c==='se') ? 'nwse-resize' : 'nesw-resize' }}
                    onPointerDown={e => onDownHandle(e, item, c)} />
                );
              })}
            </g>
          );
        })}

        {/* Marquee being dragged. */}
        {marquee && (
          <rect
            x={Math.min(marquee.x0, marquee.x1) * RE_PX_PER_FT}
            y={Math.min(marquee.y0, marquee.y1) * RE_PX_PER_FT}
            width={Math.abs(marquee.x1 - marquee.x0) * RE_PX_PER_FT}
            height={Math.abs(marquee.y1 - marquee.y0) * RE_PX_PER_FT}
            fill="rgba(201,100,66,.10)" stroke="#c96442" strokeWidth={1}
            strokeDasharray="4 3" style={{ pointerEvents:'none' }} />
        )}

        {/* Group / multi-selection bounding box. */}
        {selectedIds.length > 1 && (() => {
          const sel = items.filter(it => selectedIds.includes(it.id))
            .map(it => footprintBounds(it.x, it.y, it.w, it.d, it.angle || 0));
          const minX = Math.min(...sel.map(it => it.x));
          const minY = Math.min(...sel.map(it => it.y));
          const maxX = Math.max(...sel.map(it => it.x + it.w));
          const maxY = Math.max(...sel.map(it => it.y + it.d));
          return (
            <rect x={minX*RE_PX_PER_FT - 3} y={minY*RE_PX_PER_FT - 3}
              width={(maxX-minX)*RE_PX_PER_FT + 6} height={(maxY-minY)*RE_PX_PER_FT + 6}
              fill="none" stroke="#c96442" strokeWidth={1.2} strokeDasharray="5 3"
              rx={3} style={{ pointerEvents:'none' }} />
          );
        })()}
      </g>
    </svg>
  );
}

// Draggable list of rooms for the home-view render order. `rooms` arrives
// back→front; shown top→bottom as front→back (top row = front, drawn over the
// rows below). Dragging a row and dropping it on another reorders via the
// standard splice (drag down ⇒ land after target, drag up ⇒ land before), which
// reaches both ends, then stamps every room's contiguous homeOrder through
// onReorder (called with the new back→front id list).
function HomeLayerList({ rooms, currentRoomId, onReorder }) {
  const display = [...rooms].reverse();
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);

  function drop(targetId) {
    if (dragId && dragId !== targetId) {
      const ids = display.map(r => r.id);
      const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
      if (from >= 0 && to >= 0) {
        ids.splice(from, 1);
        ids.splice(to, 0, dragId);
        onReorder([...ids].reverse());   // display is front→back; homeOrder wants back→front
      }
    }
    setDragId(null); setOverId(null);
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      {display.map(r => {
        const isCurrent = r.id === currentRoomId;
        const isOver = overId === r.id && dragId && dragId !== r.id;
        return (
          <div key={r.id} draggable
            onDragStart={e => { setDragId(r.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={e => { e.preventDefault(); if (overId !== r.id) setOverId(r.id); }}
            onDragLeave={() => setOverId(o => (o === r.id ? null : o))}
            onDrop={e => { e.preventDefault(); drop(r.id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            style={{
              display:'flex', alignItems:'center', gap:8, padding:'7px 9px',
              borderRadius:7, fontSize:12, cursor:'grab', userSelect:'none',
              background: isCurrent ? 'rgba(201,100,66,.12)' : 'rgba(255,255,255,.65)',
              border: '1.5px solid ' + (isOver ? '#c96442'
                : isCurrent ? 'rgba(201,100,66,.45)' : 'rgba(58,42,30,.15)'),
              opacity: dragId === r.id ? 0.4 : 1,
              transition: 'border-color .12s, background .12s',
            }}>
            <span style={{ opacity:.35, fontSize:13, lineHeight:1 }}>⠿</span>
            <span style={{ fontWeight: isCurrent ? 700 : 500, color:'#3a2a1e' }}>{r.name}</span>
            {isCurrent && (
              <span style={{ marginLeft:'auto', fontSize:9, opacity:.55,
                fontFamily:'JetBrains Mono, monospace' }}>editing</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Side panel — selected piece props, add/delete, storage toggle.
// ──────────────────────────────────────────────────────────────
// Small pill button used by the Home view walls rows.
const reChip = {
  padding:'3px 7px', borderRadius:6, cursor:'pointer', fontSize:11,
  border:'1px solid rgba(58,42,30,.25)', background:'#fff', color:'#3a2a1e',
  fontFamily:'Inter, system-ui, sans-serif', whiteSpace:'nowrap',
};

// Doors currently in effect for a room, in the editable {pos, width} shape.
// When `room.doors` is absent these come from the pieces labelled Door, which
// is what the home view already renders — so the editor opens showing the
// doors that are actually on screen rather than an empty slate.
function reDerivedDoors(room) {
  if (room.doors) return room.doors;
  if (typeof classifyRoomEdges !== 'function' || !room.points) return {};
  const edges = classifyRoomEdges(room, (window.APARTMENT || {}).rooms || []);
  const spans = roomDoorSpans(room, edges);
  const out = {};
  for (const k of Object.keys(spans)) {
    const [t0, t1] = spans[k][0];
    out[k] = { pos: (t0 + t1) / 2, width: (t1 - t0) * ((edges[k] && edges[k].len) || 1) };
  }
  return out;
}

function RoomEditorPanel({ room, items, area, selectedIds, primaryId,
                            onPatchItem, onAddItem, onDeleteSelected,
                            onSetStorage, onReorder, onRotate, onSaveToCatalog,
                            homeLayerRooms = [], onSetRoomOrder,
                            onCycleHomeWall, onSetDoor, onPatchMany,
                            onGroup, onUngroup, onFinish }) {
  const [layerOpen, setLayerOpen] = React.useState(false);
  // Edges as the home view classifies them, plus what `auto` currently resolves
  // to, so the button can say auto·on / auto·off rather than just "auto".
  const homeEdges = React.useMemo(() => {
    if (!room || !room.points || typeof classifyRoomEdges !== 'function') return [];
    const bare = { ...room, homeWalls: undefined };
    return classifyRoomEdges(room, (window.APARTMENT || {}).rooms || [])
      .map(e => ({ ...e, autoShown: homeWallShown(bare, e) }));
  }, [room]);
  const homeDoors = React.useMemo(() => reDerivedDoors(room), [room]);
  const labelOnFocus = React.useRef('');  // for propagating a label rename to Notion on blur
  const roomLayerPos = homeLayerRooms.findIndex(r => r.id === room.id);
  const item = items.find(i => i.id === primaryId);
  const selCount = selectedIds.length;
  const canGroup = selCount >= 2;
  const canUngroup = !!(item && item.groupId);
  const storageEntry = item && area.find(a => a.furniture === item.id);
  const [recent, setRecent] = React.useState(reRecentColors);
  // The native colour picker fires a change per frame while you sweep the
  // spectrum, so recording every one floods the recents with the shades passed
  // through on the way. Record the value it comes to rest on instead. A timer
  // rather than blur/change: those differ across browsers, and React maps
  // onBlur from focusout, which the picker does not reliably produce.
  const recentTimer = React.useRef(null);
  function rememberSoon(c) {
    clearTimeout(recentTimer.current);
    recentTimer.current = setTimeout(() => setRecent(rePushRecent(c)), 700);
  }
  React.useEffect(() => () => clearTimeout(recentTimer.current), []);
  // Colour applies to the whole selection — with marquee select it is normal to
  // have a desk and its legs highlighted, and recolouring only the primary
  // piece would be the surprising half of that.
  // `remember` is false while the native picker is being dragged: it fires a
  // change per frame as you sweep the spectrum, so recording each one would
  // flood the recents with every shade passed through on the way. The pick is
  // recorded on blur instead, when the picker closes on a colour actually
  // chosen. Swatch clicks are already discrete, so they record immediately.
  function applyColor(c, remember = true) {
    if (remember) { clearTimeout(recentTimer.current); setRecent(rePushRecent(c)); }
    if (selCount > 1 && onPatchMany) {
      const updates = {};
      selectedIds.forEach(id => { updates[id] = { color: c }; });
      onPatchMany(updates);
    } else if (item) {
      onPatchItem(item.id, { color: c });
    }
  }
  // Draw order is per view angle — list pieces back→front exactly as the room
  // shows them at its current rotation (matches reorderItem's ordering).
  const viewRot = room.viewRot || 0;
  const orderBb = bbox(room.points);
  const orderIds = isoDepthSort(items.map(it => rotRect(it, viewRot, orderBb.w, orderBb.d)), viewRot).map(it => it.id);
  const sortedIdx = item ? orderIds.indexOf(item.id) : -1;
  const canBack = sortedIdx > 0;
  const canForward = sortedIdx >= 0 && sortedIdx < orderIds.length - 1;

  const SECTION_TITLE = { fontWeight:700, marginBottom:8, fontSize:11, opacity:.6, textTransform:'uppercase', letterSpacing:.5 };
  const SECTION = { borderTop:'1px solid rgba(58,42,30,.18)', paddingTop:12 };
  const inputBase = { padding:'5px 7px', border:'1px solid rgba(58,42,30,.18)',
    borderRadius:6, background:'#fff', fontSize:13 };

  function ftin(label, key, min = null) {
    return (
      <FtInField label={label} value={item[key] ?? 0} min={min}
        onChange={v => onPatchItem(item.id, { [key]: v })} />
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:16, fontSize:12 }}>
      {/* Pinned to the top: below the Selected piece section it shifted up and
          down every time the selection changed, which moved the thing you were
          watching while you worked. */}
      <div style={SECTION}>
        <div style={SECTION_TITLE}>Live room view</div>
        <RoomIsoPreview room={room} />
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <button onClick={onAddItem} style={edBtn()}>+ Add furniture</button>
        <button onClick={onDeleteSelected} disabled={!selCount}
          style={edBtn(!selCount)}>Delete{selCount > 1 ? ` (${selCount})` : ''}</button>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        <button onClick={onGroup} disabled={!canGroup} style={edBtn(!canGroup)}
          title="Group selected pieces so they move together">⧉ Group</button>
        <button onClick={onUngroup} disabled={!canUngroup} style={edBtn(!canUngroup)}
          title="Ungroup">⤬ Ungroup</button>
        <span style={{ fontSize:11, opacity:.6 }}>
          {selCount > 1 ? `${selCount} selected` : 'shift-click to multi-select'}
        </span>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        <button onClick={onSaveToCatalog} disabled={!selCount} style={edBtn(!selCount)}
          title="Save the selection as reusable furniture, available in every room">
          ⤓ Save to catalog{selCount > 1 ? ` (${selCount})` : ''}
        </button>
      </div>

      <div style={SECTION}>
        <div style={SECTION_TITLE}>Selected piece</div>
        {!item && <div style={{ opacity:.55, fontStyle:'italic' }}>Click a piece to edit, or add one above.</div>}
        {item && selCount > 1 && (
          <div style={{ fontSize:11, opacity:.6, marginBottom:8 }}>
            Editing <b>{item.label || item.id}</b> of {selCount} selected.
          </div>
        )}
        {item && item.groupId && (
          <div style={{ fontSize:11, color:'#c96442', marginBottom:8 }}>
            ⧉ part of a group — moves together
          </div>
        )}
        {item && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <span style={{ opacity:.7, fontSize:11 }}>Label</span>
              <input type="text" value={item.label || ''}
                placeholder={item.id}
                onChange={e => onPatchItem(item.id, { label: e.target.value })}
                style={inputBase} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ opacity:.7, fontSize:11 }}>Color</span>
                {/* Shape toggle — rectangle vs circle (ellipse / cylinder) */}
                <div style={{ display:'flex', border:'1px solid rgba(58,42,30,.25)', borderRadius:6, overflow:'hidden' }}>
                  {[['rect','▭','Rectangle'], ['circle','◯','Circle']].map(([val, glyph, title]) => {
                    const active = (item.shape || 'rect') === val;
                    return (
                      <button key={val} title={title}
                        onClick={() => onPatchItem(item.id, { shape: val })}
                        style={{ width:30, height:24, border:'none', cursor:'pointer', fontSize:13, lineHeight:1,
                          background: active ? '#3a2a1e' : 'transparent',
                          color: active ? '#fff8eb' : 'rgba(58,42,30,.7)' }}>{glyph}</button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                <input type="color" value={item.color || '#a87850'}
                  onChange={e => { applyColor(e.target.value, false); rememberSoon(e.target.value); }}
                  style={{ width:42, height:28, border:'1px solid rgba(58,42,30,.18)', borderRadius:6, background:'#fff', padding:2 }} />
                {RE_DEFAULT_COLORS.map(c => (
                  <button key={c} title={c}
                    onClick={() => applyColor(c)}
                    style={{ width:18, height:18, borderRadius:4, background:c,
                      border: item.color === c ? '2px solid #3a2a1e' : '1px solid rgba(58,42,30,.25)',
                      cursor:'pointer', padding:0 }} />
                ))}
              </div>
              {selCount > 1 && (
                <div style={{ fontSize:10, opacity:.55, marginTop:2 }}>
                  Applies to all {selCount} selected pieces.
                </div>
              )}
              {recent.length > 0 && (
                <div style={{ marginTop:6 }}>
                  <div style={{ fontSize:10, opacity:.5, marginBottom:3 }}>Recent</div>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                    {recent.map(c => (
                      <button key={'r'+c} title={c} onClick={() => applyColor(c)}
                        style={{ width:18, height:18, borderRadius:4, background:c,
                          border: item.color === c ? '2px solid #3a2a1e' : '1px solid rgba(58,42,30,.25)',
                          cursor:'pointer', padding:0 }} />
                    ))}
                  </div>
                </div>
              )}
            </label>

            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {ftin('X', 'x', 0)}
              {ftin('Y', 'y', 0)}
              {ftin('Width', 'w', RE_SNAP)}
              {ftin('Depth', 'd', RE_SNAP)}
              {ftin('Height', 'h', 0.1)}
              {ftin('Lift z', 'z', 0)}
            </div>

            {/* Angle. 45° steps, because the storage nook and the hallway don't
                meet at right angles and their furniture has to sit square to
                the wall it's against, not to the grid. */}
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ opacity:.7, fontSize:11 }}>Angle</span>
              <button onClick={() => onRotate(-1)} style={edBtn()}
                title="Rotate 45° counter-clockwise (⇧R)">↺</button>
              <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:12,
                minWidth:36, textAlign:'center' }}>{item.angle || 0}°</span>
              <button onClick={() => onRotate(1)} style={edBtn()}
                title="Rotate 45° clockwise (R)">↻</button>
              {selCount > 1 && (
                <span style={{ fontSize:10, opacity:.55 }}>turns all {selCount} as one</span>
              )}
            </div>

            <div style={{ borderTop:'1px dashed rgba(58,42,30,.18)', paddingTop:10, display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ fontSize:11, opacity:.7 }}>
                Order
                <span style={{ fontFamily:'JetBrains Mono, monospace', marginLeft:6, opacity:.7 }}>
                  ({sortedIdx + 1}/{orderIds.length})
                </span>
                <span style={{ fontFamily:'JetBrains Mono, monospace', marginLeft:6, opacity:.5 }}>
                  · view {viewRot * 90}°
                </span>
              </div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                <button onClick={() => onReorder(item.id, 'back')}
                  disabled={!canBack} style={edBtn(!canBack)} title="Send to back">⤓ Back</button>
                <button onClick={() => onReorder(item.id, 'down')}
                  disabled={!canBack} style={edBtn(!canBack)} title="Send backward">↓</button>
                <button onClick={() => onReorder(item.id, 'up')}
                  disabled={!canForward} style={edBtn(!canForward)} title="Bring forward">↑</button>
                <button onClick={() => onReorder(item.id, 'front')}
                  disabled={!canForward} style={edBtn(!canForward)} title="Bring to front">⤒ Front</button>
              </div>
              <div style={{ fontSize:10, opacity:.5, lineHeight:1.4 }}>
                Saved per view angle. Rotate the room (↺/↻ in room view) and
                re-open to arrange another angle.
              </div>
            </div>

            <div style={{ borderTop:'1px dashed rgba(58,42,30,.18)', paddingTop:10, display:'flex', flexDirection:'column', gap:8 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                <input type="checkbox" checked={!!storageEntry}
                  onChange={e => onSetStorage(item.id, e.target.checked)} />
                <span><b>Storage unit</b> — can hold items</span>
              </label>
              {storageEntry && (
                <div style={{ display:'flex', flexDirection:'column', gap:6, paddingLeft:24 }}>
                  <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    <span style={{ opacity:.7, fontSize:11 }}>Storage label</span>
                    <input type="text" value={storageEntry.label || ''}
                      onFocus={e => { labelOnFocus.current = e.target.value; }}
                      onChange={e => onSetStorage(item.id, true, { label: e.target.value })}
                      onBlur={e => {
                        // Mirror the new label into the Notion "Container" column on
                        // this container's existing rows (the join key is unaffected).
                        const v = e.target.value;
                        if (v !== labelOnFocus.current && (INVENTORY[item.id] || []).length && window.apiRelabelContainer) {
                          window.apiRelabelContainer(item.id, v)
                            .catch(err => console.warn('Evee: relabel failed —', err.message));
                        }
                      }}
                      style={inputBase} />
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    <span style={{ opacity:.7, fontSize:11 }}>Glow face</span>
                    <select value={storageEntry.face || 'front'}
                      onChange={e => onSetStorage(item.id, true, { face: e.target.value })}
                      style={{ ...inputBase, width:120 }}>
                      <option value="front">Front</option>
                      <option value="top">Top</option>
                      <option value="front2">Front (second)</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {onCycleHomeWall && homeEdges.length > 0 && (
        <div style={SECTION}>
          <div style={SECTION_TITLE}>Home view walls</div>
          <div style={{ fontSize:10, opacity:.55, lineHeight:1.4, marginBottom:8 }}>
            Walls in the dollhouse view. <b>Auto</b> draws the two far-facing sides and
            leaves the near ones open. Separate from the room view's own walls.
          </div>
          {homeEdges.map(e => {
            const ov = room.homeWalls && room.homeWalls[e.i];
            const state = ov === undefined ? 'auto' : ov ? 'on' : 'off';
            const shown = ov === undefined ? e.autoShown : !!ov;
            const door = homeDoors[e.i];
            return (
              <div key={e.i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                <span style={{ width:14, fontFamily:'JetBrains Mono, monospace', fontSize:10, opacity:.45 }}>
                  {e.i + 1}
                </span>
                <span style={{ width:46, fontSize:10, opacity:.55 }}>
                  {e.shared ? 'interior' : 'exterior'}
                </span>
                <button onClick={() => onCycleHomeWall(e.i)} title="auto → always on → always off"
                  style={{ ...reChip, minWidth: 60,
                    opacity: shown ? 1 : .45,
                    fontWeight: state === 'auto' ? 400 : 700 }}>
                  {state === 'auto' ? (shown ? 'auto·on' : 'auto·off') : state}
                </button>
                <button onClick={() => onSetDoor(e.i, door ? null : { pos: .5, width: 3 })}
                  style={{ ...reChip, minWidth: 46,
                    background: door ? 'rgba(138,127,209,.18)' : reChip.background }}>
                  {door ? 'door' : '+door'}
                </button>
                {door && (
                  <input type="range" min="0" max="1" step="0.01" value={door.pos ?? .5}
                    title="Move the door along this wall"
                    onChange={ev => onSetDoor(e.i, { pos: Number(ev.target.value) })}
                    style={{ flex:1, minWidth: 40 }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {onSetRoomOrder && homeLayerRooms.length > 0 && (
        <div style={SECTION}>
          <button onClick={() => setLayerOpen(o => !o)}
            style={{ display:'flex', alignItems:'center', gap:8, width:'100%',
              background:'transparent', border:'none', padding:0, cursor:'pointer',
              color:'inherit', textAlign:'left' }}>
            <span style={{ ...SECTION_TITLE, marginBottom:0 }}>Home view layer</span>
            {roomLayerPos >= 0 && (
              <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:11, opacity:.6 }}>
                {roomLayerPos + 1}/{homeLayerRooms.length}
              </span>
            )}
            <span style={{ marginLeft:'auto', fontSize:10, opacity:.5,
              transform: layerOpen ? 'rotate(90deg)' : 'none', transition:'transform .15s' }}>▶</span>
          </button>
          {layerOpen && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:10, opacity:.55, lineHeight:1.4, marginBottom:8 }}>
                Drag rooms to reorder. A room higher in the list draws over rooms
                below it — fixes furniture poking through a neighbour at a shared wall.
              </div>
              <div style={{ fontSize:9, opacity:.45, fontFamily:'JetBrains Mono, monospace', marginBottom:4 }}>▲ FRONT · on top</div>
              <HomeLayerList rooms={homeLayerRooms} currentRoomId={room.id}
                onReorder={onSetRoomOrder} />
              <div style={{ fontSize:9, opacity:.45, fontFamily:'JetBrains Mono, monospace', marginTop:4 }}>▼ BACK</div>
            </div>
          )}
        </div>
      )}

      <div style={{ ...SECTION, display:'flex', gap:6 }}>
        <button onClick={onFinish} style={edBtn(false, 'finish')}>✓ Done</button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// RoomEditor — top-level UI (canvas + splitter + side panel).
// ──────────────────────────────────────────────────────────────
function RoomEditor({ roomId, apt, setApt, furniture, setFurniture, storageAreas, setStorageAreas,
                      catalog = [], setCatalog, onFinish }) {
  const room = (apt || APARTMENT).rooms.find(r => r.id === roomId);
  const [selectedIds, setSelectedIds] = React.useState([]);
  const [primaryId, setPrimaryId] = React.useState(null);
  const [panelWidth, setPanelWidth] = React.useState(340);
  const [railOpen, setRailOpen] = React.useState(true);
  const containerRef = React.useRef(null);
  const items = furniture[roomId] || [];
  const area = storageAreas[roomId] || [];

  // Keyboard shortcuts for the selected piece(s). Ignored while typing in a
  // form field so label/number editing keeps arrow keys, d, etc.
  React.useEffect(() => {
    function onKey(e) {
      if (!selectedIds.length) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const STEP = 1 / 12;
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); nudgeSelected(-STEP, 0); break;
        case 'ArrowRight': e.preventDefault(); nudgeSelected(STEP, 0); break;
        case 'ArrowUp':    e.preventDefault(); nudgeSelected(0, -STEP); break;
        case 'ArrowDown':  e.preventDefault(); nudgeSelected(0, STEP); break;
        // Shift-R turns the other way — 45° steps mean seven taps to undo one
        // overshoot otherwise.
        case 'r': e.preventDefault(); rotateSelected(1); break;
        case 'R': e.preventDefault(); rotateSelected(-1); break;
        case 'd': case 'D': e.preventDefault(); duplicateSelected(); break;
        case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, items]);

  // Every hook above the bail-out, deliberately: the room can vanish mid-edit
  // now that the plan syncs (another device deleting it, or a plan loaded
  // elsewhere), and a `!room` return that skipped a hook took the whole app
  // down with "rendered fewer hooks than expected" — a blank page, not a
  // missing panel.
  if (!room) {
    return (
      <div style={{ position:'fixed', inset:0, display:'flex', alignItems:'center',
        justifyContent:'center', background:'#efe1c6' }}>
        <button onClick={onFinish} style={edBtn(false, 'finish')}>← Back</button>
      </div>
    );
  }

  // Interactive rooms in home-view render order (back→front, walls excluded) for
  // the draggable layer list.
  const homeLayerRooms = homeRoomOrder((apt || APARTMENT).rooms.filter(r => !r.noInteract))
    .map(r => ({ id: r.id, name: r.name || r.id }));

  function patchItem(id, patch) {
    setFurniture(f => ({
      ...f,
      [roomId]: (f[roomId] || []).map(it => it.id === id ? { ...it, ...patch } : it),
    }));
  }
  // Batch position update (group / multi-select drag).
  function patchMany(updates) {
    setFurniture(f => ({
      ...f,
      [roomId]: (f[roomId] || []).map(it => updates[it.id] ? { ...it, ...updates[it.id] } : it),
    }));
  }
  // Selection: clicking a grouped piece selects the whole group; the clicked
  // piece becomes primary (its props show in the panel).
  function select(id, additive) {
    const members = reGroupMembers(items, id);
    setPrimaryId(id);
    setSelectedIds(prev => {
      if (additive) {
        const allIn = members.every(m => prev.includes(m));
        if (allIn) return prev.filter(x => !members.includes(x));
        const base = prev.filter(x => !members.includes(x));
        return [...base, ...members.filter(m => m !== id), id];
      }
      return [...members.filter(m => m !== id), id];
    });
  }
  function selectMany(ids, additive) {
    const expanded = [];
    ids.forEach(id => reGroupMembers(items, id).forEach(m => {
      if (!expanded.includes(m)) expanded.push(m);
    }));
    if (!expanded.length) return;
    setSelectedIds(prev => {
      const base = additive ? prev.filter(x => !expanded.includes(x)) : [];
      return [...base, ...expanded];
    });
    setPrimaryId(expanded[expanded.length - 1]);
  }
  function clearSelection() { setSelectedIds([]); setPrimaryId(null); }
  function addItem() {
    // Random suffix so two pieces created in the same millisecond can't collide
    // on an id (the id is also the container id / Notion "Container ID").
    const id = 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const bb = bbox(room.points);
    const newItem = {
      id, label: 'New piece',
      x: reSnap(bb.w / 2 - 1), y: reSnap(bb.d / 2 - 1),
      w: 2, d: 2, h: 2.5,
      color: RE_DEFAULT_COLORS[(items.length) % RE_DEFAULT_COLORS.length],
    };
    setFurniture(f => ({ ...f, [roomId]: [...(f[roomId] || []), newItem] }));
    setSelectedIds([id]); setPrimaryId(id);
  }
  function deleteSelected() {
    if (!selectedIds.length) return;
    const ids = selectedIds;
    // Guard: deleting a container piece unlinks its Notion items (the id is gone
    // for good). Items aren't deleted from Notion, but warn before orphaning them.
    const n = ids.reduce((sum, id) => sum + (INVENTORY[id] || []).length, 0);
    if (n && !window.confirm(
        `The selected piece(s) hold ${n} item${n > 1 ? 's' : ''} tracked in Notion. ` +
        `Deleting removes the container(s); the items stay in Notion but become unlinked. Continue?`)) {
      return;
    }
    setFurniture(f => ({ ...f, [roomId]: (f[roomId] || []).filter(it => !ids.includes(it.id)) }));
    setStorageAreas(s => ({ ...s, [roomId]: (s[roomId] || []).filter(a => !ids.includes(a.furniture)) }));
    clearSelection();
  }
  // ─── Catalog ────────────────────────────────────────────────
  // Save the current selection as a reusable assembly. The pieces travel; the
  // ids don't (see reCatalogEntry) — so the copy in another room is its own
  // furniture with its own, empty containers.
  function saveSelectionToCatalog() {
    if (!setCatalog || !selectedIds.length) return;
    const sel = items.filter(it => selectedIds.includes(it.id));
    if (!sel.length) return;
    const prim = items.find(i => i.id === primaryId);
    const suggested = (prim && prim.label) || sel[0].label || 'Saved furniture';
    const name = window.prompt(
      `Save ${sel.length} piece${sel.length > 1 ? 's' : ''} to the catalog as:`, suggested);
    if (name === null) return;                       // cancelled
    setCatalog(c => [...c, reCatalogEntry(name.trim() || suggested, sel, area)]);
  }
  // Drop a saved assembly into this room, centred like a new piece, selected as
  // one group so it can be dragged/nudged straight into place.
  function placeCatalogEntry(entry) {
    const bb = bbox(room.points);
    const { pieces, areas } = rePlaceEntry(
      entry, reSnap(bb.w / 2 - entry.w / 2), reSnap(bb.d / 2 - entry.d / 2), items);
    setFurniture(f => ({ ...f, [roomId]: [...(f[roomId] || []), ...pieces] }));
    if (areas.length) {
      setStorageAreas(s => ({ ...s, [roomId]: [...(s[roomId] || []), ...areas] }));
    }
    setSelectedIds(pieces.map(p => p.id));
    setPrimaryId(pieces[pieces.length - 1].id);
  }
  function renameCatalogEntry(entry) {
    if (!setCatalog) return;
    const name = window.prompt('Rename this saved furniture:', entry.name);
    if (name === null || !name.trim()) return;
    setCatalog(c => c.map(e => e.id === entry.id ? { ...e, name: name.trim() } : e));
  }
  // Removing a catalog entry touches nothing already placed — those are their
  // own pieces in their own rooms, and always were.
  function deleteCatalogEntry(entry) {
    if (!setCatalog) return;
    if (!window.confirm(`Remove "${entry.name}" from the catalog? Copies already placed in rooms stay where they are.`)) return;
    setCatalog(c => c.filter(e => e.id !== entry.id));
  }

  function groupSelected() {
    if (selectedIds.length < 2) return;
    const gid = 'g-' + Date.now().toString(36);
    const ids = selectedIds;
    setFurniture(f => ({ ...f, [roomId]: (f[roomId] || []).map(it => ids.includes(it.id) ? { ...it, groupId: gid } : it) }));
  }
  function ungroupSelected() {
    const prim = items.find(i => i.id === primaryId);
    const gid = prim && prim.groupId;
    if (!gid) return;
    setFurniture(f => ({ ...f, [roomId]: (f[roomId] || []).map(it => it.groupId === gid ? { ...it, groupId: undefined } : it) }));
  }
  // Nudge the whole selection by (dx,dy) feet, snapped.
  function nudgeSelected(dx, dy) {
    if (!selectedIds.length) return;
    const updates = {};
    selectedIds.forEach(id => {
      const it = items.find(x => x.id === id);
      if (it) updates[id] = { x: reSnap(it.x + dx), y: reSnap(it.y + dy) };
    });
    patchMany(updates);
  }
  // Rotate the selection 45° about its bounding-box center — each piece turns
  // on the spot *and* orbits the centre, so a group rotates as one rigid body.
  //
  // 45°, not 90°, because the rooms themselves aren't all square: the storage
  // nook and the hallway run at an angle, and the furniture in them has to
  // follow the walls. Two steps still land on a right angle, so the old
  // behaviour is a double tap away.
  //
  // A turn that lands back on a multiple of 90° is baked into w/d and the angle
  // dropped — a w×d rect turned 90° *is* a d×w rect — so `angle` only ever
  // marks a genuinely diagonal piece and every axis-aligned path (depth sort,
  // wall tests, the plain box renderer) keeps working exactly as before.
  function rotateSelected(dir = 1) {
    if (!selectedIds.length) return;
    const sel = items.filter(it => selectedIds.includes(it.id));
    const bnds = sel.map(s => footprintBounds(s.x, s.y, s.w, s.d, s.angle || 0));
    const cx = (Math.min(...bnds.map(b => b.x)) + Math.max(...bnds.map(b => b.x + b.w))) / 2;
    const cy = (Math.min(...bnds.map(b => b.y)) + Math.max(...bnds.map(b => b.y + b.d))) / 2;
    const th = dir * Math.PI / 4, cs = Math.cos(th), sn = Math.sin(th);
    const updates = {};
    sel.forEach(s => {
      const dx = s.x + s.w / 2 - cx, dy = s.y + s.d / 2 - cy;
      const ncx = cx + dx * cs - dy * sn;   // clockwise for dir=1 (x→right, y→down)
      const ncy = cy + dx * sn + dy * cs;
      const ang = (((s.angle || 0) + dir * 45) % 360 + 360) % 360;
      const square = ang % 90 === 0;
      const nw = square && ang % 180 === 90 ? s.d : s.w;
      const nd = square && ang % 180 === 90 ? s.w : s.d;
      updates[s.id] = {
        x: reSnap(ncx - nw / 2), y: reSnap(ncy - nd / 2), w: nw, d: nd,
        angle: square ? undefined : ang,    // undefined ⇒ key drops on save
      };
    });
    patchMany(updates);
  }
  // Duplicate the selection, offset slightly; new copies become the selection.
  function duplicateSelected() {
    if (!selectedIds.length) return;
    const sel = items.filter(it => selectedIds.includes(it.id));
    const ts = Date.now().toString(36);
    const groupRemap = {};
    const newIds = [];
    const clones = sel.map((s, i) => {
      const nid = 'f-' + ts + i.toString(36) + Math.random().toString(36).slice(2, 5);
      newIds.push(nid);
      let groupId = s.groupId;
      if (groupId) groupId = groupRemap[groupId] || (groupRemap[groupId] = 'g-' + ts);
      // Directly on top of the original: an offset copy has to be dragged back
      // into place, and the common use is duplicating a piece to restyle it or
      // to build up a stack in situ.
      return { ...s, id: nid, x: s.x, y: s.y, groupId };
    });
    setFurniture(f => ({ ...f, [roomId]: [...(f[roomId] || []), ...clones] }));
    // Carry over storage-area entries for any cloned storage pieces.
    setStorageAreas(s => {
      const list = s[roomId] || [];
      const extra = [];
      sel.forEach((src, i) => {
        list.filter(a => a.furniture === src.id).forEach(a => {
          extra.push({ ...a, id: newIds[i], furniture: newIds[i], items: 0 });
        });
      });
      return extra.length ? { ...s, [roomId]: [...list, ...extra] } : s;
    });
    setSelectedIds(newIds);
    setPrimaryId(newIds[newIds.length - 1]);
  }
  // Cycle a single edge's wall state for the CURRENT view angle: auto → on → off
  // → auto. Overrides are stored per rotation (`wallOverrides[rot][edge]`), so a
  // wall forced on/off at one angle leaves the other angles untouched. Legacy
  // flat overrides are migrated to the per-angle shape on first edit.
  function cycleWall(edgeIdx) {
    if (!setApt) return;
    const rot = room.viewRot || 0;
    setApt(a => ({
      ...a,
      rooms: a.rooms.map(r => {
        if (r.id !== roomId) return r;
        const wo = reMigrateWallOverrides(r.wallOverrides);
        const perRot = { ...(wo[rot] || {}) };
        const cur = perRot[edgeIdx];
        const next = cur === undefined ? true : cur === true ? false : undefined;
        if (next === undefined) delete perRot[edgeIdx]; else perRot[edgeIdx] = next;
        if (Object.keys(perRot).length) wo[rot] = perRot; else delete wo[rot];
        return { ...r, wallOverrides: wo };
      }),
    }));
  }

  // Home-view wall visibility for one edge: auto → on → off → auto. Kept
  // separate from `wallOverrides` above, which is keyed by view angle because
  // the room view rotates; the home view has one fixed camera, so a flat
  // `homeWalls[edge]` map is the honest shape.
  function cycleHomeWall(edgeIdx) {
    if (!setApt) return;
    setApt(a => ({
      ...a,
      rooms: a.rooms.map(r => {
        if (r.id !== roomId) return r;
        const hw = { ...(r.homeWalls || {}) };
        const cur = hw[edgeIdx];
        const next = cur === undefined ? true : cur === true ? false : undefined;
        if (next === undefined) delete hw[edgeIdx]; else hw[edgeIdx] = next;
        if (Object.keys(hw).length) return { ...r, homeWalls: hw };
        const cleared = { ...r }; delete cleared.homeWalls; return cleared;
      }),
    }));
  }

  // A door opening on one edge. An absent `room.doors` means "derive the
  // openings from the pieces labelled Door", so the first manual edit has to
  // materialise those derived doors first — otherwise adding one door would
  // silently drop every other door in the room.
  function setDoor(edgeIdx, patch) {
    if (!setApt) return;
    setApt(a => ({
      ...a,
      rooms: a.rooms.map(r => {
        if (r.id !== roomId) return r;
        const doors = { ...(r.doors || reDerivedDoors(r)) };
        if (patch === null) delete doors[edgeIdx];
        else doors[edgeIdx] = { ...(doors[edgeIdx] || { pos: 0.5, width: 3 }), ...patch };
        return { ...r, doors };
      }),
    }));
  }

  // Reorder a piece (or, if it's grouped, its whole group as one block) in the
  // draw stack — *for the current view angle only*. We take the exact
  // back→front order shown at this rotation (rotate the room-local geometry
  // the same way RoomScene does, then isoDepthSort), pull every group member
  // out as a contiguous block (this also consolidates a group whose members
  // aren't yet adjacent), reinsert the block one slot over (or at an end),
  // then stamp every piece with a contiguous integer in its `zOrders[rot]`
  // slot. Other angles keep their own order. Once an angle is touched its
  // whole stack is explicit, so the iso render at that angle matches this
  // list exactly (isoDepthSort treats explicit order as authoritative) — and
  // each angle can be arranged to look correct on its own.
  function reorderItem(id, direction) {
    const rot = room.viewRot || 0;
    setFurniture(f => {
      const list = f[roomId] || [];
      const bb = bbox(room.points);
      const order = isoDepthSort(list.map(it => rotRect(it, rot, bb.w, bb.d)), rot).map(it => it.id);
      const groupSet = new Set(reGroupMembers(list, id));
      const block = order.filter(pid => groupSet.has(pid));   // group's members, back→front
      if (!block.length) return f;
      const rest = order.filter(pid => !groupSet.has(pid));
      const firstIdx = order.indexOf(block[0]);
      let restIdx = 0;                 // rest-items before the block, i.e. its slot among `rest`
      for (let k = 0; k < firstIdx; k++) if (!groupSet.has(order[k])) restIdx++;
      let insertAt;
      if (direction === 'back') insertAt = 0;
      else if (direction === 'front') insertAt = rest.length;
      else if (direction === 'down') insertAt = Math.max(0, restIdx - 1);
      else if (direction === 'up') insertAt = Math.min(rest.length, restIdx + 1);
      else return f;
      rest.splice(insertAt, 0, ...block);   // reinsert the whole block together
      const zById = {};
      rest.forEach((pid, idx) => { zById[pid] = idx; });
      return { ...f, [roomId]: list.map(it => ({ ...it, zOrders: { ...(it.zOrders || {}), [rot]: zById[it.id] } })) };
    });
  }
  // Commit a new home-view room order from the draggable layer list. Furniture is
  // drawn one room at a time, back→front (see homeRoomOrder), so a "front" room's
  // pieces draw over a "back" room's — this is what keeps furniture from one room
  // poking through another at a shared wall. `idsBackToFront` is the full list of
  // interactive rooms in render order; we stamp every one with a contiguous
  // integer `homeOrder` (walls are skipped — they hold no furniture). Stamping all
  // of them keeps explicit ranks and the geometric-depth fallback from ever mixing.
  function setHomeRoomOrder(idsBackToFront) {
    if (!setApt) return;
    setApt(a => {
      const rank = {};
      idsBackToFront.forEach((id, idx) => { rank[id] = idx; });
      return { ...a, rooms: a.rooms.map(r => (r.noInteract || rank[r.id] == null) ? r : { ...r, homeOrder: rank[r.id] }) };
    });
  }
  function setStorage(id, on, patch) {
    // Guard: turning storage OFF removes the container locally. Its Notion items
    // aren't deleted, but they'd disappear from the app until storage is turned
    // back on for this same piece. Warn if there's anything to hide.
    if (!on) {
      const n = (INVENTORY[id] || []).length;
      if (n && !window.confirm(
          `This container has ${n} item${n > 1 ? 's' : ''} tracked in Notion. ` +
          `Turning off storage hides ${n > 1 ? 'them' : 'it'} from the app — they stay in Notion ` +
          `and return if you turn storage back on for this piece. Continue?`)) {
        return;
      }
    }
    setFurniture(f => ({
      ...f,
      [roomId]: (f[roomId] || []).map(it => it.id === id ? { ...it, storage: !!on, ...(on && patch?.label ? { label: patch.label } : {}) } : it),
    }));
    setStorageAreas(s => {
      const list = s[roomId] || [];
      const existing = list.find(a => a.furniture === id);
      let nextList;
      if (!on) {
        nextList = list.filter(a => a.furniture !== id);
      } else if (existing) {
        nextList = list.map(a => a.furniture === id ? { ...a, ...patch } : a);
      } else {
        const item = (furniture[roomId] || []).find(it => it.id === id);
        nextList = [...list, {
          id, label: patch?.label || item?.label || 'Storage',
          furniture: id, face: patch?.face || 'front', items: 0,
        }];
      }
      return { ...s, [roomId]: nextList };
    });
  }

  function onSplitterDrag(clientX) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = Math.max(260, Math.min(560, rect.right - clientX));
    setPanelWidth(w);
  }

  return (
    <div ref={containerRef} style={{ position:'fixed', inset:0, display:'flex',
      background:'#efe1c6', color:'#3a2a1e', fontFamily:'Inter, system-ui, sans-serif' }}>
      <CatalogRail catalog={catalog} collapsed={!railOpen}
        onToggle={() => setRailOpen(o => !o)}
        onPlace={placeCatalogEntry}
        onRename={renameCatalogEntry} onDelete={deleteCatalogEntry} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <div style={{ padding:'12px 18px', borderBottom:'1px solid rgba(58,42,30,.18)',
          display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={onFinish} style={topBtn} title="Done">←</button>
          <div style={{ lineHeight:1.05 }}>
            <div style={{ fontFamily:'Caveat, cursive', fontSize:22, fontWeight:700 }}>
              Modify {room.name}
            </div>
            <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:9, color:'rgba(58,42,30,.6)', marginTop:3 }}>
              top-down · drag to move · drag corners to resize · 1″ snap
            </div>
          </div>
        </div>
        <div style={{ flex:1, overflow:'auto', padding:24, display:'flex',
          alignItems:'flex-start', justifyContent:'center', position:'relative' }}>
          <RoomCanvas room={room} items={items}
            selectedIds={selectedIds} primaryId={primaryId}
            onSelect={select} onClear={clearSelection} onSelectMany={selectMany}
            onPatchItem={patchItem} onMoveMany={patchMany}
            onCycleWall={cycleWall} />
          {selectedIds.length > 0 && (
            <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
              display:'flex', gap:10, alignItems:'center', whiteSpace:'nowrap',
              fontFamily:'JetBrains Mono, monospace', fontSize:10, color:'rgba(58,42,30,.7)',
              background:'rgba(255,248,235,.92)', border:'1px solid rgba(58,42,30,.18)',
              borderRadius:999, padding:'6px 14px', boxShadow:'0 4px 14px rgba(58,42,30,.12)' }}>
              <span><b>↑ ↓ ← →</b> move</span><span style={{ opacity:.3 }}>·</span>
              <span><b>R</b> rotate 45°<span style={{ opacity:.5 }}> (⇧R back)</span></span><span style={{ opacity:.3 }}>·</span>
              <span><b>D</b> duplicate</span><span style={{ opacity:.3 }}>·</span>
              <span><b>⌫</b> delete</span>
            </div>
          )}
        </div>
      </div>
      <EditorSplitter onDrag={onSplitterDrag} />
      <div style={{ width: panelWidth, flexShrink:0, overflow:'auto',
        background:'rgba(255,248,235,.6)' }}>
        <RoomEditorPanel room={room} items={items} area={area}
          selectedIds={selectedIds} primaryId={primaryId}
          onPatchItem={patchItem} onAddItem={addItem} onDeleteSelected={deleteSelected}
          onSetStorage={setStorage} onReorder={reorderItem} onRotate={rotateSelected}
          onSaveToCatalog={saveSelectionToCatalog}
          homeLayerRooms={homeLayerRooms} onSetRoomOrder={setHomeRoomOrder}
          onCycleHomeWall={cycleHomeWall} onSetDoor={setDoor} onPatchMany={patchMany}
          onGroup={groupSelected} onUngroup={ungroupSelected} onFinish={onFinish} />
      </div>
    </div>
  );
}

Object.assign(window, { RoomEditor, RoomCanvas, RoomEditorPanel, CatalogRail, CatalogThumb,
  reCatalogEntry, rePlaceEntry });
