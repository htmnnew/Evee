// ─── editor.jsx ───
// Floor-plan editor integrated into the Evee app. Top-down 2D view of polygon
// rooms with drag-to-move bodies, drag-vertex reshape, click-edge split,
// right-click delete. Ported from an earlier standalone prototype, slimmed
// down to polygons only (no legacy rect handles).

const ED_SNAP_STEP = 1 / 12; // 1 inch
const ED_PX_PER_FT = 22;

function edSnap(v, step = ED_SNAP_STEP) { return Math.round(v / step) * step; }
function edSnapPt(p) { return { x: edSnap(p.x), y: edSnap(p.y) }; }
function edFmtFt(v) {
  const inches = Math.round(v * 12);
  const ft = Math.trunc(inches / 12);
  const inch = Math.abs(inches % 12);
  return inch === 0 ? `${ft}′` : `${ft}′ ${inch}″`;
}
function edRectToPoints(r) {
  return [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.d }, { x: r.x, y: r.y + r.d },
  ];
}

// ──────────────────────────────────────────────────────────────
// PlanEditor — the 2D top-down SVG canvas (drag rooms, drag vertices,
// split edges by clicking edge midpoints, right-click vertex to delete).
// ──────────────────────────────────────────────────────────────
function PlanEditor({ apt, setApt, selectedId, setSelectedId, editable = true }) {
  const W = apt.width, D = apt.depth;
  const svgRef = React.useRef(null);
  const dragRef = React.useRef(null);

  const PAD = 24;
  const canvasW = W * ED_PX_PER_FT + PAD * 2;
  const canvasH = D * ED_PX_PER_FT + PAD * 2;

  function ftFromEvent(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      fx: (e.clientX - rect.left - PAD) / ED_PX_PER_FT,
      fy: (e.clientY - rect.top  - PAD) / ED_PX_PER_FT,
    };
  }

  function onMouseDownRoom(e, r) {
    e.stopPropagation();
    setSelectedId(r.id);
    if (!editable) return;
    const { fx, fy } = ftFromEvent(e);
    dragRef.current = { kind: 'move', id: r.id, startX: fx, startY: fy, origPoints: r.points };
  }
  function onMouseDownVertex(e, r, vi) {
    e.stopPropagation();
    if (!editable) return;
    setSelectedId(r.id);
    const { fx, fy } = ftFromEvent(e);
    dragRef.current = { kind: 'vertex', id: r.id, vi, startX: fx, startY: fy, origPoints: r.points };
  }
  function onClickEdgeAdd(e, r, ei) {
    e.stopPropagation();
    if (!editable) return;
    setApt(a => ({
      ...a,
      rooms: a.rooms.map(rr => {
        if (rr.id !== r.id) return rr;
        const a0 = rr.points[ei], a1 = rr.points[(ei + 1) % rr.points.length];
        const mid = edSnapPt({ x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 });
        const np = [...rr.points];
        np.splice(ei + 1, 0, mid);
        return { ...rr, points: np };
      }),
    }));
  }
  function onContextMenuVertex(e, r, vi) {
    e.preventDefault();
    if (!editable || r.points.length <= 3) return;
    setApt(a => ({
      ...a,
      rooms: a.rooms.map(rr => rr.id !== r.id ? rr : { ...rr, points: rr.points.filter((_, i) => i !== vi) }),
    }));
  }
  function onMouseDownCanvas() { setSelectedId(null); }

  React.useEffect(() => {
    function onMove(e) {
      if (!dragRef.current) return;
      const { fx, fy } = ftFromEvent(e);
      const d = dragRef.current;
      const dx = fx - d.startX, dy = fy - d.startY;
      setApt(a => ({
        ...a,
        rooms: a.rooms.map(r => {
          if (r.id !== d.id) return r;
          if (d.kind === 'move') {
            return { ...r, points: d.origPoints.map(p => edSnapPt({ x: p.x + dx, y: p.y + dy })) };
          } else if (d.kind === 'vertex') {
            return { ...r, points: r.points.map((p, i) =>
              i === d.vi ? edSnapPt({ x: d.origPoints[i].x + dx, y: d.origPoints[i].y + dy }) : p
            )};
          }
          return r;
        }),
      }));
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [setApt]);

  // Grid lines every 1 ft, heavier every 5 ft.
  const grid = [];
  for (let i = 0; i <= W; i++) {
    grid.push(<line key={'vx'+i} x1={i*ED_PX_PER_FT} y1={0} x2={i*ED_PX_PER_FT} y2={D*ED_PX_PER_FT}
      stroke="rgba(58,42,30,.18)" strokeWidth={i % 5 === 0 ? 0.8 : 0.3} />);
  }
  for (let i = 0; i <= D; i++) {
    grid.push(<line key={'vy'+i} x1={0} y1={i*ED_PX_PER_FT} x2={W*ED_PX_PER_FT} y2={i*ED_PX_PER_FT}
      stroke="rgba(58,42,30,.18)" strokeWidth={i % 5 === 0 ? 0.8 : 0.3} />);
  }

  return (
    <svg ref={svgRef} width={canvasW} height={canvasH}
      style={{ display:'block', background:'#faf3e1', borderRadius:8 }}
      onMouseDown={onMouseDownCanvas}>
      <g transform={`translate(${PAD},${PAD})`}>
        {grid}
        <rect x={0} y={0} width={W*ED_PX_PER_FT} height={D*ED_PX_PER_FT}
          fill="none" stroke="rgba(58,42,30,.35)" strokeWidth={1.5} strokeDasharray="4 3" />

        {apt.rooms.map(r => {
          const isSel = r.id === selectedId;
          const c = centroid(r.points);
          const bb = bbox(r.points);
          const polyStr = r.points.map(p => `${p.x*ED_PX_PER_FT},${p.y*ED_PX_PER_FT}`).join(' ');
          return (
            <g key={r.id}>
              <polygon
                points={polyStr}
                fill={r.color || '#cdb98d'}
                stroke={isSel ? '#c96442' : 'rgba(58,42,30,.5)'}
                strokeWidth={isSel ? 2.5 : 1}
                strokeLinejoin="round"
                style={{ cursor: editable ? 'move' : 'pointer' }}
                onMouseDown={e => onMouseDownRoom(e, r)} />
              <text x={c.x*ED_PX_PER_FT} y={c.y*ED_PX_PER_FT - 4}
                textAnchor="middle" fontSize={12} fontWeight={600}
                fill="rgba(58,42,30,.9)" style={{ pointerEvents:'none' }}>{r.name}</text>
              <text x={c.x*ED_PX_PER_FT} y={c.y*ED_PX_PER_FT + 10}
                textAnchor="middle" fontSize={10} fontFamily="JetBrains Mono, monospace"
                fill="rgba(58,42,30,.65)" style={{ pointerEvents:'none' }}>
                {edFmtFt(bb.w)} × {edFmtFt(bb.d)}
              </text>

              {/* Edge midpoint "+" buttons */}
              {isSel && editable && r.points.map((p, i) => {
                const next = r.points[(i + 1) % r.points.length];
                const mx = (p.x + next.x) / 2 * ED_PX_PER_FT;
                const my = (p.y + next.y) / 2 * ED_PX_PER_FT;
                return (
                  <g key={'em' + i} style={{ cursor:'cell' }} onMouseDown={e => onClickEdgeAdd(e, r, i)}>
                    <circle cx={mx} cy={my} r={7} fill="#fff" stroke="#c96442" strokeWidth={1.2} opacity={0.85} />
                    <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={11} fontWeight={700}
                      fill="#c96442" style={{ pointerEvents:'none' }}>+</text>
                  </g>
                );
              })}

              {/* Vertex handles */}
              {isSel && editable && r.points.map((p, i) => (
                <rect key={'v' + i}
                  x={p.x*ED_PX_PER_FT - 5} y={p.y*ED_PX_PER_FT - 5}
                  width={10} height={10}
                  fill="#fff" stroke="#c96442" strokeWidth={1.5}
                  style={{ cursor: 'move' }}
                  onMouseDown={e => onMouseDownVertex(e, r, i)}
                  onContextMenu={e => onContextMenuVertex(e, r, i)} />
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────
// Side panel — apartment dims, selected-room props, Finish/Export/Reset.
// ──────────────────────────────────────────────────────────────
function EdNumField({ label, value, onChange, step = ED_SNAP_STEP, min = 0 }) {
  return (
    <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:11 }}>
      <span style={{ opacity:.7 }}>{label}</span>
      <input type="number" value={value} step={step} min={min}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ padding:'5px 7px', border:'1px solid rgba(58,42,30,.18)', borderRadius:6,
          background:'#fff', fontSize:13, width:70 }} />
    </label>
  );
}
function edBtn(disabled = false, kind = 'default') {
  const bg = disabled ? 'rgba(58,42,30,.08)' :
             kind === 'primary' ? '#c96442' :
             kind === 'finish' ? '#5a7d3a' : '#3a2a1e';
  return {
    padding:'7px 12px', fontSize:12, fontWeight:600,
    background: bg,
    color: disabled ? 'rgba(58,42,30,.4)' : '#f8eedd',
    border:'none', borderRadius:6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function EditorPropsPanel({ apt, setApt, selectedId, setSelectedId, onFinish, onExport, onReset }) {
  const room = apt.rooms.find(r => r.id === selectedId);

  function updateRoom(patch) {
    setApt(a => ({ ...a, rooms: a.rooms.map(r => r.id === selectedId ? { ...r, ...patch } : r) }));
  }
  function addRoom() {
    const id = 'room' + Date.now().toString(36);
    const newR = { id, name: 'New room', color: '#cdb98d',
      points: edRectToPoints({ x: 4, y: 4, w: 8, d: 8 }) };
    setApt(a => ({ ...a, rooms: [...a.rooms, newR] }));
    setSelectedId(id);
  }
  function deleteRoom() {
    if (!selectedId) return;
    setApt(a => ({ ...a, rooms: a.rooms.filter(r => r.id !== selectedId) }));
    setSelectedId(null);
  }

  const SECTION_TITLE = { fontWeight:700, marginBottom:8, fontSize:11, opacity:.6, textTransform:'uppercase', letterSpacing:.5 };
  const SECTION = { borderTop:'1px solid rgba(58,42,30,.18)', paddingTop:12 };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:16, fontSize:12 }}>
      <div style={{ display:'flex', gap:6 }}>
        <button onClick={addRoom} style={edBtn()}>+ Add room</button>
        <button onClick={deleteRoom} disabled={!selectedId} style={edBtn(!selectedId)}>Delete</button>
      </div>

      <div style={SECTION}>
        <div style={SECTION_TITLE}>Apartment</div>
        <div style={{ display:'flex', gap:8 }}>
          <EdNumField label="Width (ft)" value={apt.width} onChange={v => setApt(a => ({ ...a, width: v }))} step={1} />
          <EdNumField label="Depth (ft)" value={apt.depth} onChange={v => setApt(a => ({ ...a, depth: v }))} step={1} />
        </div>
      </div>

      <div style={SECTION}>
        <div style={SECTION_TITLE}>Selected room</div>
        {!room && <div style={{ opacity:.55, fontStyle:'italic' }}>Click a room to edit.</div>}
        {room && (() => {
          const bb = bbox(room.points);
          return (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <span style={{ opacity:.7, fontSize:11 }}>Name</span>
                <input type="text" value={room.name}
                  onChange={e => updateRoom({ name: e.target.value })}
                  style={{ padding:'5px 7px', border:'1px solid rgba(58,42,30,.18)', borderRadius:6, background:'#fff', fontSize:13 }} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <span style={{ opacity:.7, fontSize:11 }}>Color</span>
                <input type="color" value={room.color || '#cdb98d'}
                  onChange={e => updateRoom({ color: e.target.value })}
                  style={{ width:60, height:28, border:'1px solid rgba(58,42,30,.18)', borderRadius:6, background:'#fff', padding:2 }} />
              </label>
              <div style={{ display:'flex', gap:14, fontSize:11, opacity:.8, paddingTop:4 }}>
                <div><div style={{ opacity:.6 }}>Bbox</div><div style={{ fontFamily:'JetBrains Mono, monospace' }}>{edFmtFt(bb.w)} × {edFmtFt(bb.d)}</div></div>
                <div><div style={{ opacity:.6 }}>Origin</div><div style={{ fontFamily:'JetBrains Mono, monospace' }}>({edFmtFt(bb.x)}, {edFmtFt(bb.y)})</div></div>
                <div><div style={{ opacity:.6 }}>Vertices</div><div style={{ fontFamily:'JetBrains Mono, monospace' }}>{room.points.length}</div></div>
              </div>
              <div style={{ fontSize:11, opacity:.65, lineHeight:1.5, padding:'8px 10px',
                background:'rgba(58,42,30,.04)', borderRadius:6 }}>
                <b>Reshape:</b> drag a corner to move it · click <b style={{ color:'#c96442' }}>+</b> on an edge
                to split it into two · right-click a corner to remove it (min 3).
              </div>
            </div>
          );
        })()}
      </div>

      <div style={{ ...SECTION, display:'flex', gap:6, flexWrap:'wrap' }}>
        <button onClick={onFinish} style={edBtn(false, 'finish')}>✓ Finish</button>
        <button onClick={onExport} style={edBtn()}>Export JSON</button>
        <button onClick={onReset} style={edBtn()}>Reset</button>
      </div>

      <div style={{ ...SECTION, fontSize:11, opacity:.65, lineHeight:1.5 }}>
        Editing only changes the floor-plan shape. Furniture for each room is preserved
        as long as the room id is unchanged.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Splitter — draggable column divider.
// ──────────────────────────────────────────────────────────────
function EditorSplitter({ onDrag }) {
  const dragging = React.useRef(false);
  React.useEffect(() => {
    function onMove(e) { if (dragging.current) onDrag(e.clientX); }
    function onUp() { dragging.current = false; document.body.style.cursor = ''; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onDrag]);
  return (
    <div
      onMouseDown={() => { dragging.current = true; document.body.style.cursor = 'col-resize'; }}
      style={{ width: 6, cursor: 'col-resize', flexShrink: 0,
        background: 'transparent', borderLeft: '1px solid rgba(58,42,30,.18)',
        borderRight: '1px solid rgba(58,42,30,.18)', position: 'relative' }}>
      <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        width:2, height:32, background:'rgba(58,42,30,.3)', borderRadius:2 }} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// FloorPlanEditor — top-level editor UI (canvas + splitter + side panel).
// ──────────────────────────────────────────────────────────────
function FloorPlanEditor({ apt, setApt, onFinish, onExport }) {
  const [selectedId, setSelectedId] = React.useState(null);
  const [panelWidth, setPanelWidth] = React.useState(340);
  // Snapshot for Reset.
  const snapshotRef = React.useRef(apt);

  React.useEffect(() => {
    function onKey(e) {
      const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (!editing && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setApt(a => ({ ...a, rooms: a.rooms.filter(r => r.id !== selectedId) }));
        setSelectedId(null);
      }
      if (e.key === 'Escape') setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, setApt]);

  function onSplitterDrag(clientX) {
    const w = window.innerWidth - clientX;
    setPanelWidth(Math.max(220, Math.min(window.innerWidth - 280, w)));
  }

  return (
    <div style={{ position:'fixed', inset:0, display:'flex', background:'#efe1c6', userSelect:'none' }}>
      <div style={{ flex:1, overflow:'auto', padding:24, minWidth:0 }}>
        <div style={{ marginBottom:14, fontSize:12, opacity:.7 }}>
          Floor-plan editor — drag a room to move, drag corners/edges to reshape.
          Esc deselects. Snaps to 1 in.
        </div>
        <PlanEditor apt={apt} setApt={setApt}
          selectedId={selectedId} setSelectedId={setSelectedId} editable={true} />
      </div>
      <EditorSplitter onDrag={onSplitterDrag} />
      <div style={{ width:panelWidth, flexShrink:0, background:'#fbf3df',
        overflowY:'auto', boxShadow:'-2px 0 12px rgba(58,42,30,.06)' }}>
        <EditorPropsPanel apt={apt} setApt={setApt}
          selectedId={selectedId} setSelectedId={setSelectedId}
          onFinish={onFinish}
          onExport={onExport}
          onReset={() => setApt(snapshotRef.current)} />
      </div>
    </div>
  );
}

Object.assign(window, { FloorPlanEditor });
