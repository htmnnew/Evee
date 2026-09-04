// ─── panels.jsx ───
// Item side panel (slides in from right) + extras overlays
// (search, timeline, alerts).

// ──────────────────────────────────────────────────────────────
// ItemSidePanel — right-anchored, lists items in a storage area.
// ──────────────────────────────────────────────────────────────
function ItemSidePanel({ areaId, roomId, items = [], onAddItem, onUpdateItem, onDeleteItem, onClose }) {
  // Close when clicking anywhere outside the panel.
  const panelRef = React.useRef(null);
  React.useEffect(() => {
    function onDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Doubles as the live filter for the list and the draft name for "+ add".
  const [q, setQ] = React.useState('');

  if (!areaId) return null;
  const room = APARTMENT.rooms.find(r => r.id === roomId);
  const area = (STORAGE_AREAS[roomId] || []).find(a => a.id === areaId);
  if (!area) return null;

  const filter = q.trim().toLowerCase();
  const visible = filter
    ? items.filter(it => (it.name || '').toLowerCase().includes(filter))
    : items;
  function addDraft() {
    const name = q.trim();
    if (!name || !onAddItem) return;
    onAddItem({ name, quantity: 1 });
    setQ('');
  }

  return (
    <div ref={panelRef} style={{
      position:'fixed', top: 0, right: 0, bottom: 0, width: 340, zIndex: 70,
      background:'#fbf3e1', borderLeft:'1.5px solid rgba(58,42,30,.25)',
      boxShadow:'-6px 0 24px rgba(58,42,30,.18)',
      display:'flex', flexDirection:'column',
      fontFamily:'Inter, system-ui, sans-serif',
      animation:'panelSlide .26s cubic-bezier(.2,.7,.2,1)',
    }}>
      <style>{`@keyframes panelSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

      <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid rgba(58,42,30,.12)' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 9, color:'rgba(58,42,30,.5)', letterSpacing: '.06em', textTransform:'uppercase' }}>
              {room.name}
            </div>
            <div style={{ fontFamily:'Caveat, cursive', fontSize: 26, fontWeight: 700, color:'#3a2a1e', lineHeight: 1 }}>
              {area.label}
            </div>
          </div>
          <button onClick={onClose} style={panelClose}>×</button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap: 8, marginTop: 8 }}>
          <span style={statPill}>{items.length} items</span>
        </div>
      </div>

      {/* Search + add (type a name, Enter or "+ add" creates it) */}
      <div style={{ padding:'10px 14px' }}>
        <form onSubmit={(e) => { e.preventDefault(); addDraft(); }}
          style={{ display:'flex', alignItems:'center', gap: 8,
          background:'#fff8eb', border:'1.5px solid rgba(58,42,30,.18)', borderRadius: 8,
          padding:'6px 10px' }}>
          <span style={{ fontSize: 13, color:'rgba(58,42,30,.5)' }}>🔍</span>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder={`search or add in ${area.label.toLowerCase()}…`}
            style={{ flex: 1, border:'none', outline:'none', background:'transparent',
              fontFamily:'inherit', fontSize: 12, color:'#3a2a1e' }} />
          <button type="submit" style={addBtn}>+ add</button>
        </form>
      </div>

      <div style={{ flex: 1, overflowY:'auto', padding:'0 10px 12px',
        display:'flex', flexDirection:'column', gap: 6 }}>
        {visible.length === 0 ? (
          <div style={{ margin:'auto', textAlign:'center', color:'rgba(58,42,30,.4)',
            fontFamily:'Caveat, cursive', fontSize: 18, padding: 24 }}>
            {q.trim() ? `no match — press + add for “${q.trim()}”` : 'nothing here yet'}
          </div>
        ) : visible.map(it => (
          <ItemRow key={it.id} item={it}
            onRename={(name) => onUpdateItem && onUpdateItem(it.id, { name })}
            onQty={(quantity) => onUpdateItem && onUpdateItem(it.id, { quantity })}
            onDelete={() => onDeleteItem && onDeleteItem(it.id)} />
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ItemRow — one inventory item: rename (click name), qty steppers, delete.
// ──────────────────────────────────────────────────────────────
function ItemRow({ item, onRename, onQty, onDelete }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(item.name || '');
  React.useEffect(() => { setName(item.name || ''); }, [item.name]);
  const qty = item.quantity ?? null;

  function commit() {
    setEditing(false);
    const n = name.trim();
    if (n && n !== item.name) onRename(n);
    else setName(item.name || '');
  }

  return (
    <div style={{ display:'flex', alignItems:'center', gap: 8,
      background:'#fff8eb', border:'1.5px solid rgba(58,42,30,.14)', borderRadius: 8,
      padding:'6px 8px 6px 10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input autoFocus value={name}
            onChange={e => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setName(item.name || ''); setEditing(false); }
            }}
            style={{ width:'100%', border:'none', outline:'none', background:'transparent',
              fontFamily:'inherit', fontSize: 13, fontWeight: 600, color:'#3a2a1e' }} />
        ) : (
          <div onClick={() => setEditing(true)} title="Click to rename"
            style={{ fontSize: 13, fontWeight: 600, color:'#3a2a1e', cursor:'text',
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {item.name || 'untitled'}
          </div>
        )}
        {item.notes ? (
          <div style={{ fontSize: 10, color:'rgba(58,42,30,.55)', whiteSpace:'nowrap',
            overflow:'hidden', textOverflow:'ellipsis' }}>{item.notes}</div>
        ) : null}
      </div>
      {qty != null && (
        <div style={{ display:'flex', alignItems:'center', gap: 4 }}>
          <button onClick={() => onQty(Math.max(0, (qty || 0) - 1))} style={stepBtn}>−</button>
          <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 12, minWidth: 16, textAlign:'center' }}>{qty}</span>
          <button onClick={() => onQty((qty || 0) + 1)} style={stepBtn}>+</button>
        </div>
      )}
      <button onClick={onDelete} title="Delete" style={rowDelBtn}>×</button>
    </div>
  );
}

const stepBtn = {
  width: 22, height: 22, borderRadius: 6, border:'1px solid rgba(58,42,30,.25)',
  background:'#efe1c6', color:'#3a2a1e', cursor:'pointer', fontSize: 13, lineHeight: 1,
  display:'inline-flex', alignItems:'center', justifyContent:'center',
};
const rowDelBtn = {
  width: 22, height: 22, borderRadius: 6, border:'none', background:'transparent',
  color:'rgba(58,42,30,.45)', cursor:'pointer', fontSize: 16, lineHeight: 1,
};

// Relative time label from an ISO timestamp ("2h ago", "3d ago").
function relTime(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return Math.floor(m) + 'm ago';
  const h = m / 60; if (h < 24) return Math.floor(h) + 'h ago';
  const d = h / 24; if (d < 7) return Math.floor(d) + 'd ago';
  const w = d / 7; if (w < 5) return Math.floor(w) + 'w ago';
  const mo = d / 30; if (mo < 12) return Math.floor(mo) + 'mo ago';
  return Math.floor(d / 365) + 'y ago';
}

// One clickable item row (item name + container·room, optional right-aligned time).
function ResultRow({ item, onClick, time }) {
  return (
    <button onClick={onClick} style={resultRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color:'#3a2a1e',
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {item.name || 'untitled'}{item.quantity != null ? ` ×${item.quantity}` : ''}
        </div>
        <div style={{ fontSize: 11, color:'rgba(58,42,30,.55)',
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {item.container || '—'}{item.room ? ' · ' + item.room : ''}
        </div>
      </div>
      {time && <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 10,
        color:'rgba(58,42,30,.5)', whiteSpace:'nowrap', marginLeft: 8 }}>{time}</span>}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// SearchOverlay — ⌘K global item search (client-side over loaded inventory)
// ──────────────────────────────────────────────────────────────
function SearchOverlay({ onClose, onGoTo, items = [] }) {
  const [q, setQ] = React.useState('');
  const query = q.trim().toLowerCase();
  const results = (query
    ? items.filter(it =>
        (it.name || '').toLowerCase().includes(query) ||
        (it.container || '').toLowerCase().includes(query) ||
        (it.room || '').toLowerCase().includes(query))
    : items
  ).slice(0, 50);
  return (
    <ModalShell onClose={onClose} width={520}>
      <div style={{ padding:'14px 16px', borderBottom:'1px solid rgba(58,42,30,.1)',
        display:'flex', alignItems:'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>🔍</span>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="search items…"
          style={{ flex: 1, border:'none', outline:'none', background:'transparent',
          fontFamily:'inherit', fontSize: 18, color:'#3a2a1e' }} />
        <kbd style={kbd}>esc</kbd>
      </div>
      {results.length === 0 ? (
        <div style={overlayEmpty}>
          {items.length === 0 ? 'no items yet' : query ? 'no items found' : 'no items'}
        </div>
      ) : (
        <div style={{ maxHeight:'52vh', overflowY:'auto', padding: 6 }}>
          {results.map(it => (
            <ResultRow key={it.id} item={it} onClick={() => onGoTo(it.roomId, it.containerId)} />
          ))}
        </div>
      )}
    </ModalShell>
  );
}

// ──────────────────────────────────────────────────────────────
// TimelineOverlay — recently added/changed items (by Notion created_time)
// ──────────────────────────────────────────────────────────────
function TimelineOverlay({ onClose, items = [], onGoTo }) {
  const recent = items.filter(it => it.created)
    .sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    .slice(0, 25);
  return (
    <DrawerShell side="right" onClose={onClose} title="Recently added"
      subtitle={recent.length ? `last ${recent.length}` : 'nothing added yet'}>
      {recent.length === 0 ? (
        <div style={overlayEmpty}>nothing here yet</div>
      ) : (
        <div style={{ padding: 6 }}>
          {recent.map(it => (
            <ResultRow key={it.id} item={it} time={relTime(it.created)}
              onClick={() => onGoTo(it.roomId, it.containerId)} />
          ))}
        </div>
      )}
    </DrawerShell>
  );
}

// ──────────────────────────────────────────────────────────────
// AlertsOverlay — things needing attention: low stock + orphaned items
// (rows in Notion whose container no longer exists in the app).
// ──────────────────────────────────────────────────────────────
function AlertsOverlay({ onClose, orphans = [], lowStock = [], containers = [], onReassign, onDelete, onGoTo }) {
  const orphanCount = orphans.reduce((s, o) => s + o.items.length, 0);
  const total = orphanCount + lowStock.length;
  return (
    <DrawerShell side="right" onClose={onClose} title="Alerts"
      subtitle={total ? `${total} need${total === 1 ? 's' : ''} attention` : 'all clear'}>
      {total === 0 ? (
        <div style={overlayEmpty}>nothing to report</div>
      ) : (
        <div style={{ padding: 12 }}>
          {lowStock.length > 0 && (
            <React.Fragment>
              <div style={alertSection}>Low stock</div>
              <div style={alertHint}>Running low or out — tap to open the container.</div>
              {lowStock.map(it => (
                <button key={it.id} onClick={() => onGoTo(it.roomId, it.containerId)} style={lowRow}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color:'#3a2a1e',
                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    <span style={{ fontWeight: 600 }}>{it.name || 'untitled'}</span>
                    <span style={{ fontSize: 11, color:'rgba(58,42,30,.55)' }}> · {it.container || '—'}</span>
                  </span>
                  <span style={it.quantity === 0 ? lowBadgeOut : lowBadgeLow}>
                    {it.quantity === 0 ? 'out' : `${it.quantity} left`}
                  </span>
                </button>
              ))}
            </React.Fragment>
          )}
          {orphans.length > 0 && (
            <React.Fragment>
              <div style={{ ...alertSection, marginTop: lowStock.length ? 14 : 2 }}>Untracked items</div>
              <div style={alertHint}>
                These items are still in Notion, but their container no longer exists in the app
                (its piece was deleted, storage was turned off, or a plan was loaded). Move them into
                a container, or delete them.
              </div>
              {orphans.map(o => (
                <OrphanCard key={o.containerId} orphan={o} containers={containers}
                  onReassign={onReassign} onDelete={onDelete} />
              ))}
            </React.Fragment>
          )}
        </div>
      )}
    </DrawerShell>
  );
}

function OrphanCard({ orphan, containers, onReassign, onDelete }) {
  const [target, setTarget] = React.useState('');
  const count = orphan.items.length;
  return (
    <div style={{ background:'#fff8eb', border:'1.5px solid rgba(58,42,30,.16)', borderRadius: 10,
      padding: 10, marginBottom: 8 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color:'#3a2a1e' }}>{orphan.label || '(unknown container)'}</span>
        {orphan.room && <span style={{ fontSize: 11, color:'rgba(58,42,30,.55)' }}>· {orphan.room}</span>}
        <span style={{ marginLeft:'auto', fontFamily:'JetBrains Mono, monospace', fontSize: 10,
          color:'rgba(58,42,30,.6)' }}>{count} item{count > 1 ? 's' : ''}</span>
      </div>
      <div style={{ fontSize: 11, color:'rgba(58,42,30,.6)', margin:'4px 0 8px',
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        {orphan.items.map(i => i.name + (i.quantity != null ? ` ×${i.quantity}` : '')).join(', ')}
      </div>
      <div style={{ display:'flex', gap: 6 }}>
        <select value={target} onChange={e => setTarget(e.target.value)}
          style={{ flex: 1, minWidth: 0, fontFamily:'inherit', fontSize: 11, padding:'4px 6px',
            borderRadius: 7, border:'1.5px solid rgba(58,42,30,.22)', background:'#fbf3e1', color:'#3a2a1e' }}>
          <option value="">Move to…</option>
          {containers.map(c => (
            <option key={c.id} value={c.id}>{c.room} → {c.label}</option>
          ))}
        </select>
        <button disabled={!target}
          onClick={() => { const c = containers.find(x => x.id === target); if (c) onReassign(orphan.containerId, c); }}
          style={{ ...alertBtn, opacity: target ? 1 : .4, cursor: target ? 'pointer' : 'default' }}>Move</button>
        <button
          onClick={() => {
            if (window.confirm(`Delete ${count} item${count > 1 ? 's' : ''} from "${orphan.label}"? ` +
              `They'll be archived in Notion (recoverable from Trash for 30 days).`)) {
              onDelete(orphan.containerId, orphan.items);
            }
          }}
          style={{ ...alertBtn, color:'#b1492e', borderColor:'rgba(177,73,46,.4)' }}>Delete</button>
      </div>
    </div>
  );
}

const alertSection = {
  fontFamily:'JetBrains Mono, monospace', fontSize: 9, letterSpacing:'.06em',
  textTransform:'uppercase', color:'rgba(58,42,30,.5)', margin:'2px 2px 6px',
};
const alertHint = { fontSize: 11, lineHeight: 1.45, color:'rgba(58,42,30,.6)', margin:'0 2px 10px' };
const alertBtn = {
  fontFamily:'inherit', fontSize: 11, fontWeight: 600, padding:'4px 10px', borderRadius: 7,
  border:'1.5px solid rgba(58,42,30,.25)', background:'#efe1c6', color:'#3a2a1e', cursor:'pointer',
};
const overlayEmpty = {
  display:'flex', alignItems:'center', justifyContent:'center', minHeight: 160, padding: 40,
  textAlign:'center', color:'rgba(58,42,30,.4)', fontFamily:'Caveat, cursive', fontSize: 18,
};
const resultRow = {
  display:'flex', alignItems:'center', gap: 8, width:'100%', textAlign:'left',
  background:'transparent', border:'none', borderRadius: 8, padding:'7px 10px', cursor:'pointer',
  fontFamily:'inherit', color:'#3a2a1e',
};
const lowRow = {
  display:'flex', alignItems:'center', gap: 8, width:'100%', textAlign:'left',
  background:'#fff8eb', border:'1.5px solid rgba(58,42,30,.14)', borderRadius: 8,
  padding:'7px 10px', marginBottom: 6, cursor:'pointer', fontFamily:'inherit',
};
const lowBadge = {
  fontFamily:'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700, letterSpacing:'.04em',
  padding:'2px 7px', borderRadius: 999, whiteSpace:'nowrap',
};
const lowBadgeLow = { ...lowBadge, background:'rgba(196,115,88,.16)', color:'#a85433' };
const lowBadgeOut = { ...lowBadge, background:'rgba(177,73,46,.18)', color:'#9c3a23' };

// ──────────────────────────────────────────────────────────────
// Shells
// ──────────────────────────────────────────────────────────────
function ModalShell({ children, onClose, width = 480 }) {
  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset: 0, background:'rgba(58,42,30,.35)', zIndex: 100,
      display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop: '12vh',
      backdropFilter:'blur(2px)' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width, maxWidth: '92vw', background:'#fbf3e1',
        border:'1.5px solid rgba(58,42,30,.3)', borderRadius: 12,
        boxShadow:'0 20px 60px rgba(58,42,30,.35)',
        fontFamily:'Inter, system-ui, sans-serif',
        animation:'modalDrop .22s cubic-bezier(.2,.7,.2,1)' }}>
        <style>{`@keyframes modalDrop { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
        {children}
      </div>
    </div>
  );
}

function DrawerShell({ children, onClose, side = 'right', title, subtitle, width = 360 }) {
  const isRight = side === 'right';
  return (
    <div onClick={onClose} style={{ position:'fixed', inset: 0, zIndex: 80, background:'rgba(58,42,30,.18)' }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          position:'absolute', top: 0, bottom: 0, [isRight ? 'right' : 'left']: 0, width,
          background:'#fbf3e1', borderLeft: isRight ? '1.5px solid rgba(58,42,30,.25)' : 'none',
          borderRight: !isRight ? '1.5px solid rgba(58,42,30,.25)' : 'none',
          boxShadow: isRight ? '-6px 0 24px rgba(58,42,30,.18)' : '6px 0 24px rgba(58,42,30,.18)',
          display:'flex', flexDirection:'column',
          animation: `drawerIn-${side} .26s cubic-bezier(.2,.7,.2,1)`,
        }}>
        <style>{`
          @keyframes drawerIn-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
          @keyframes drawerIn-left  { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        `}</style>
        <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid rgba(58,42,30,.12)',
          display:'flex', alignItems:'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily:'Caveat, cursive', fontSize: 24, fontWeight: 700, color:'#3a2a1e', lineHeight: 1 }}>{title}</div>
            {subtitle && <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 9, color:'rgba(58,42,30,.6)' }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={panelClose}>×</button>
        </div>
        <div style={{ flex: 1, overflowY:'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────
const statPill = {
  border:'1.5px solid rgba(58,42,30,.25)', background:'#fff8eb',
  borderRadius: 999, padding:'2px 8px', fontFamily:'JetBrains Mono, monospace',
  fontSize: 10, color:'#3a2a1e',
};
const ghostBtn = {
  border:'1.5px solid rgba(58,42,30,.25)', background:'transparent',
  borderRadius: 999, padding:'4px 10px', fontSize: 11, color:'#3a2a1e', cursor:'pointer',
};
const ghostBtnDanger = { ...ghostBtn, color:'#c4413a', borderColor:'rgba(196,65,58,.4)' };
const addBtn = {
  background:'#c47358', color:'#fff8eb', border:'none',
  borderRadius: 999, padding:'4px 12px', fontSize: 11, fontWeight: 600, cursor:'pointer',
};
const panelClose = {
  width: 30, height: 30, borderRadius: 8, border:'1.5px solid rgba(58,42,30,.2)',
  background:'transparent', cursor:'pointer', color:'rgba(58,42,30,.7)', fontSize: 18, lineHeight: 1,
};
const kbd = {
  fontFamily:'JetBrains Mono, monospace', fontSize: 10, color:'rgba(58,42,30,.6)',
  border:'1px solid rgba(58,42,30,.25)', borderRadius: 4, padding:'2px 6px', background:'rgba(255,255,255,.5)',
};

// ─── Customize (⋮ → Customize) ────────────────────────────────
// Repaints the scene surfaces. Everything here writes into `apt.theme` via
// onChange, so edits show live behind the drawer and persist with the layout.
//
// All four presets are light on purpose: the UI chrome hardcodes dark ink
// (#3a2a1e and rgba(58,42,30,…) throughout), so a dark backdrop would render
// dark-on-dark. A real night theme needs the chrome themed first.
const BUILTIN_PRESETS = [
  { name: 'Warm',  patch: { bg: null,      floor: null,      wall: null, wallShade: 25, slab: '#d6c19e', plinth: null } },
  { name: 'Cool',  patch: { bg: '#cdd6e0', floor: '#aab6c2', wall: null, wallShade: 25, slab: '#c2ccd6', plinth: null } },
  { name: 'Sage',  patch: { bg: '#d5dcc8', floor: '#b3bfa4', wall: null, wallShade: 25, slab: '#c6d0b6', plinth: null } },
  { name: 'Mono',  patch: { bg: '#dcdcdc', floor: '#b8b8b8', wall: null, wallShade: 22, slab: '#cccccc', plinth: null } },
];

// A slot's values: the user's override if they saved one, else the built-in.
function resolvePreset(p, overrides) {
  return (overrides && overrides[p.name]) || p.patch;
}

function ThemePanel({ onClose, theme, onChange, onResetRooms,
                      presetOverrides, onSavePreset, onResetPreset }) {
  const [editSlots, setEditSlots] = React.useState(false);
  // Both `floor` and `wall` are nullable, and a null means "derive" rather than
  // "no colour" — but the inputs need a concrete value, so resolve first.
  const perRoomFloors = !theme.floor;
  const effFloor = theme.floor || FALLBACK_FLOOR;
  const derivedWall = shade(effFloor, theme.wallShade);
  const matchFloor = !theme.wall;
  return (
    <DrawerShell side="right" onClose={onClose} title="Customize" subtitle="scene colours">
      <div style={{ padding: 12, overflowY:'auto' }}>

        <div style={{ display:'flex', alignItems:'baseline', gap: 8 }}>
          <div style={themeSection}>Presets</div>
          <button onClick={() => setEditSlots(v => !v)}
            style={{ ...themeHint, background:'none', border:'none', cursor:'pointer',
              padding:0, textDecoration:'underline', marginLeft:'auto' }}>
            {editSlots ? 'done' : 'edit slots'}
          </button>
        </div>
        <div style={{ display:'flex', gap: 6, marginBottom: 4 }}>
          {BUILTIN_PRESETS.map(p => {
            const vals = resolvePreset(p, presetOverrides);
            const custom = !!(presetOverrides && presetOverrides[p.name]);
            return (
              <div key={p.name} style={{ flex: 1, minWidth: 0 }}>
                <button onClick={() => onChange(vals)} style={{ ...themePreset, width:'100%' }}
                  title={`Apply the ${p.name} palette`}>
                  <span style={{ display:'block', height: 22, borderRadius: 5, marginBottom: 4,
                    border:'1px solid rgba(58,42,30,.2)',
                    background:`linear-gradient(135deg, ${vals.bg || '#e9d4a5'} 50%, ${vals.floor || FALLBACK_FLOOR} 50%)` }} />
                  {p.name}{custom ? '*' : ''}
                </button>
                {editSlots && (
                  <div style={{ display:'flex', gap: 3, marginTop: 3 }}>
                    <button onClick={() => onSavePreset(p.name)} style={slotBtn}
                      title={`Overwrite ${p.name} with the current theme`}>⤓</button>
                    <button onClick={() => onResetPreset(p.name)} style={slotBtn}
                      disabled={!custom} title={custom ? `Restore the built-in ${p.name}` : 'Unchanged'}>
                      <span style={{ opacity: custom ? 1 : .3 }}>↺</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {editSlots && (
          <div style={themeHint}>
            ⤓ overwrites a slot with everything currently set, camera angle and zoom
            included. ↺ restores the built-in. A <b>*</b> marks a changed slot.
          </div>
        )}

        <div style={themeSection}>Surfaces</div>
        <ThemeRow label="Background" hint="behind the whole apartment"
          value={theme.bg || '#e9d4a5'} onChange={v => onChange({ bg: v })} />
        <ThemeRow label="Floor" hint={perRoomFloors ? 'off — rooms are using their own colours' : 'overrides every room'}
          value={effFloor} onChange={v => onChange({ floor: v })} />
        <label style={themeCheck}>
          <input type="checkbox" checked={perRoomFloors}
            onChange={e => onChange({ floor: e.target.checked ? null : effFloor })} />
          Let each room keep its own colour
        </label>
        <ThemeRow label="Platform" hint="the slab the apartment sits on"
          value={theme.slab} onChange={v => onChange({ slab: v })} />

        <div style={themeSection}>Walls</div>
        <label style={themeCheck}>
          <input type="checkbox" checked={matchFloor}
            onChange={e => onChange({ wall: e.target.checked ? null : derivedWall })} />
          Tint each room's walls from its own floor
        </label>
        {matchFloor ? (
          <div style={{ padding:'0 2px 8px' }}>
            <div style={themeHint}>How much lighter than the floor.</div>
            <input type="range" min="-40" max="60" value={theme.wallShade}
              onChange={e => onChange({ wallShade: Number(e.target.value) })}
              style={{ width:'100%' }} />
            <div style={{ display:'flex', alignItems:'center', gap: 8, marginTop: 6 }}>
              <span style={{ ...themeSwatch, background: derivedWall }} />
              <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 11,
                color:'rgba(58,42,30,.6)' }}>{derivedWall}</span>
            </div>
          </div>
        ) : (
          <ThemeRow label="Wall colour" hint="used by every room"
            value={theme.wall} onChange={v => onChange({ wall: v })} />
        )}

        <div style={themeSection}>Debug · walls</div>
        <div style={{ padding:'0 2px 10px' }}>
          <ThemeSlider label="Thickness" min={0} max={0.6} step={0.02}
            value={theme.wallThickness || 0}
            read={v => v === 0 ? 'flat' : `${v.toFixed(2)} ft`}
            onChange={v => onChange({ wallThickness: v })}
            hint="0 draws a flat plane with no top edge." />
          <ThemeSlider label="Height" min={0.5} max={8} step={0.1}
            value={theme.wallHeight ?? 3.5}
            read={v => `${v.toFixed(1)} ft`}
            onChange={v => onChange({ wallHeight: v })}
            hint="7 ft was the old full-height room wall; 3.5 lets you see over it." />
        </div>

        <div style={themeSection}>Debug · lighting</div>
        <div style={{ padding:'0 2px 10px' }}>
          <ThemeSlider label="Direction" min={0} max={359} step={1}
            value={theme.lightAzimuth ?? 270}
            read={v => `${Math.round(v)}°`}
            onChange={v => onChange({ lightAzimuth: v })}
            hint="Which side the light comes from." />
          <ThemeSlider label="Contrast" min={0} max={60} step={1}
            value={theme.lightIntensity ?? 22}
            read={v => String(Math.round(v))}
            onChange={v => onChange({ lightIntensity: v })}
            hint="Spread between the brightest and darkest wall." />
          <ThemeSlider label="Top light" min={-20} max={60} step={1}
            value={theme.lightSky ?? 18}
            read={v => (v > 0 ? '+' : '') + Math.round(v)}
            onChange={v => onChange({ lightSky: v })}
            hint="How much brighter upward-facing surfaces are." />
          <ThemeSlider label="Ambient" min={-40} max={40} step={1}
            value={theme.lightAmbient ?? 0}
            read={v => (v > 0 ? '+' : '') + Math.round(v)}
            onChange={v => onChange({ lightAmbient: v })}
            hint="Lifts or drops the whole scene together." />
        </div>

        <div style={themeSection}>Reset</div>
        <button style={themeBtn} onClick={() => onChange(null)}>Reset theme to default</button>
        <button style={themeBtn} onClick={onResetRooms}>Discard per-room colours…</button>
        <div style={themeHint}>
          A theme floor overrides every room, but does not erase anything — untick it
          and the per-room colours come back. Discarding removes them for good.
        </div>

      </div>
    </DrawerShell>
  );
}

// Labelled slider with a live readout, used by the Debug groups.
function ThemeSlider({ label, min, max, step, value, read, onChange, hint }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize: 12, color:'#3a2a1e' }}>
        <span>{label}</span>
        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 11, opacity:.6 }}>
          {read ? read(value) : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} style={{ width:'100%' }} />
      {hint && <div style={themeHint}>{hint}</div>}
    </div>
  );
}

// Label + swatch + colour input, styled like the pickers in the floor-plan and
// room editors so the three feel like one control.
function ThemeRow({ label, hint, value, onChange }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap: 10, padding:'5px 2px' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display:'block', fontSize: 13, color:'#3a2a1e' }}>{label}</span>
        {hint && <span style={themeHint}>{hint}</span>}
      </span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: 52, height: 28, flex:'0 0 auto', padding: 2, background:'#fff',
          border:'1px solid rgba(58,42,30,.18)', borderRadius: 6, cursor:'pointer' }} />
    </label>
  );
}

const themeSection = {
  fontFamily:'JetBrains Mono, monospace', fontSize: 9, letterSpacing:'.12em',
  textTransform:'uppercase', color:'rgba(58,42,30,.5)', padding:'12px 2px 6px',
};
const themeHint = { display:'block', fontSize: 11, color:'rgba(58,42,30,.55)', lineHeight: 1.35 };
const themeCheck = {
  display:'flex', alignItems:'center', gap: 8, fontSize: 12,
  color:'#3a2a1e', padding:'4px 2px 8px', cursor:'pointer',
};
const themeSwatch = {
  display:'inline-block', width: 20, height: 20, borderRadius: 5,
  border:'1px solid rgba(58,42,30,.2)',
};
const slotBtn = {
  flex: 1, minWidth: 0, padding:'2px 0', borderRadius: 5, cursor:'pointer', fontSize: 11,
  border:'1px solid rgba(58,42,30,.2)', background:'rgba(255,255,255,.6)', color:'#3a2a1e',
};

const themePreset = {
  flex: 1, minWidth: 0, padding: 6, borderRadius: 8, cursor:'pointer',
  border:'1.5px solid rgba(58,42,30,.18)', background:'rgba(255,255,255,.5)',
  fontFamily:'Inter, system-ui, sans-serif', fontSize: 11, color:'#3a2a1e',
};
const themeBtn = {
  display:'block', width:'100%', textAlign:'left', padding:'8px 10px', marginBottom: 6,
  borderRadius: 8, cursor:'pointer', border:'1.5px solid rgba(58,42,30,.18)',
  background:'rgba(255,255,255,.5)', fontFamily:'Inter, system-ui, sans-serif',
  fontSize: 12, color:'#3a2a1e',
};

Object.assign(window, { ItemSidePanel, SearchOverlay, TimelineOverlay, AlertsOverlay,
  ThemePanel, BUILTIN_PRESETS, ModalShell, DrawerShell });
