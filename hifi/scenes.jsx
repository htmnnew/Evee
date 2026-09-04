// ─── scenes.jsx ───
// Home (apartment dollhouse) and Room scene renderers.

// Ray-cast point-in-polygon test (polygon as [{x,y}, ...]).
function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

// Sort items by isometric depth (back to front) — naive scalar version, kept
// for callers that only need a rough order. Prefer isoDepthSort below.
function sortByDepth(items) {
  return [...items].sort((a, b) => (a.x + a.y + (a.z || 0)) - (b.x + b.y + (b.z || 0)));
}

// Isometric painter's sort — returns items ordered back-to-front so later-drawn
// pieces occlude earlier ones.
//
// For axis-aligned boxes the correct rule is the separating axis: if two boxes
// don't overlap along some axis, the one with the smaller coordinate on that
// axis (farther from the camera / lower) is behind. Two wrinkles make a naive
// version fail:
//   • 1-inch snapping leaves pieces overlapping by a hair, which a strict
//     "entirely past" test reads as "not separated". So we treat any overlap
//     thinner than the snap step (RE_EPS) as separation — they're touching.
//   • When more than one axis is near-separating, we pick the *clearest* one
//     (smallest overlap), not whichever we test first — otherwise a piece
//     that's far to one side but just behind on another axis sorts wrong.
// Genuinely overlapping pieces (stacked/nested, no separating axis) have no
// geometric answer, so they fall back to plan-center depth, then stack height
// `z+h`, then the explicit editor order, then index.
//
// Explicit order (set by the room editor's Order buttons) is *authoritative*:
// whenever two pieces both carry one we order by it and skip geometry entirely.
// This is how vertical stacking is controlled — rather than inferring the stack
// order from camera geometry (which flips with rotation), the editor pins it.
//
// Order is stored *per view angle* in `zOrders[rot]` (rot = 0–3 quarter-turns),
// because which piece is "in front" genuinely changes as the room rotates, so a
// single order can't be right for all four angles. A legacy scalar `zOrder` is
// honored as a fallback for any angle without its own entry. Pieces with no
// explicit order at the current angle still sort geometrically — so untouched
// rooms (and untouched angles) behave exactly as before.
const ISO_SORT_EPS = 0.1; // ~1.2 in, just over the 1-in editor snap
function isoDepthSort(items, rot = 0) {
  const n = items.length;
  if (n < 2) return items.slice();
  // A piece turned off-axis (`angle`) is compared through the bounds of its
  // rotated footprint — the separating-axis test below only speaks rectangles.
  // That is an approximation for diagonal pieces (their bounds overstretch into
  // the corners), which is what the editor's explicit Order buttons are for.
  const box = items.map(it => it.angle
    ? { ...it, ...footprintBounds(it.x, it.y, it.w, it.d, it.angle) }
    : it);
  // Explicit draw order for the current angle, or null if this piece has none.
  const ord = it => {
    const o = it.zOrders && it.zOrders[rot];
    return o != null ? o : (it.zOrder != null ? it.zOrder : null);
  };
  // rel(a,b): +1 if a is behind b, -1 if b is behind a, 0 if no separating axis.
  const rel = (a, b) => {
    // Explicit per-angle order wins over geometry when both pieces have one.
    const ao = ord(a), bo = ord(b);
    if (ao != null && bo != null && ao !== bo) return ao < bo ? 1 : -1; // smaller ⇒ behind ⇒ first
    const az0 = a.z || 0, az1 = az0 + (a.h || 0);
    const bz0 = b.z || 0, bz1 = bz0 + (b.h || 0);
    const axes = [
      { ov: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), s: (a.x - b.x) || ((a.x + a.w) - (b.x + b.w)) },
      { ov: Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y), s: (a.y - b.y) || ((a.y + a.d) - (b.y + b.d)) },
      { ov: Math.min(az1, bz1) - Math.max(az0, bz0),             s: (az0 - bz0) || (az1 - bz1) },
    ].filter(c => c.ov <= ISO_SORT_EPS && c.s !== 0);
    if (!axes.length) return 0;
    axes.sort((u, v) => u.ov - v.ov);     // clearest (smallest overlap) wins
    return axes[0].s < 0 ? 1 : -1;        // smaller coord ⇒ a behind ⇒ a first
  };
  const depth = it => (it.x + (it.w || 0) / 2) + (it.y + (it.d || 0) / 2);
  const height = it => (it.z || 0) + (it.h || 0);
  const tieCmp = (p, q) =>
    (depth(box[p]) - depth(box[q])) ||
    (height(box[p]) - height(box[q])) ||
    ((ord(box[p]) ?? 0) - (ord(box[q]) ?? 0)) ||
    (p - q);
  const adj = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = rel(box[i], box[j]);
      if (r > 0) { adj[i].push(j); indeg[j]++; }       // i behind j
      else if (r < 0) { adj[j].push(i); indeg[i]++; }  // j behind i
    }
  }
  // Kahn topological sort: draw a piece once everything behind it is drawn.
  // Among ready (nothing-behind-it-left) pieces, draw the shallowest first.
  //
  // Isometric occlusion can be genuinely cyclic (A hides B hides C hides A) once
  // many pieces interlock — dense rooms, or walls/dividers modeled as furniture —
  // so the graph isn't always fully orderable. When that stalls the queue (every
  // remaining piece still has something "behind" it), we force-release the single
  // shallowest leftover, breaking just one cycle edge, then continue. This keeps
  // honoring every other constraint instead of dumping the whole remainder by a
  // scalar — which is what the old fallback did and why it mis-ordered pieces
  // (a near-but-behind piece could outrank one it should sit behind).
  const avail = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) avail.push(i);
  const out = [];
  const used = new Array(n).fill(false);
  while (out.length < n) {
    if (!avail.length) {
      // Cycle: release the shallowest not-yet-drawn piece to break the deadlock.
      let best = -1;
      for (let i = 0; i < n; i++) if (!used[i] && (best < 0 || tieCmp(i, best) < 0)) best = i;
      avail.push(best);
    }
    avail.sort(tieCmp);                  // among ready nodes, draw shallower first
    const i = avail.shift();
    if (used[i]) continue;
    used[i] = true;
    out.push(items[i]);
    for (const j of adj[i]) { if (!used[j] && --indeg[j] === 0) avail.push(j); }
  }
  return out;
}

// ── Room-view rotation (90° snaps) ──────────────────────────────
// We rotate the room-local geometry by `rot` quarter-turns *before* the
// existing render pipeline, then everything downstream (depth sort, wall
// back-face test, projection) just works on the rotated coords. The layout is
// re-normalized to the origin so a W×D room maps to W×D (even rot) or D×W (odd).
//
// rotPoint: rotate a room-local point within a W×D box.
function rotPoint(x, y, rot, W, D) {
  switch (((rot % 4) + 4) % 4) {
    case 1:  return { x: y,           y: W - x };
    case 2:  return { x: W - x,       y: D - y };
    case 3:  return { x: D - y,       y: x };
    default: return { x, y };
  }
}
// rotRect: rotate a furniture rect (anchor + footprint). w/d swap on odd turns.
//
// A piece with its own `angle` can't express the turn by swapping w/d — those
// are its *unrotated* dimensions — so it takes the turn on the angle instead
// and keeps w/d. The two forms agree: rotating a w×d rect 90° about its centre
// is the same shape as a d×w rect there, which is why the anchor arithmetic
// below is exactly rotPoint applied to the footprint centre.
function rotRect(f, rot, W, D) {
  const r = ((rot % 4) + 4) % 4;
  if (f.angle && r) {
    const c = rotPoint(f.x + f.w / 2, f.y + f.d / 2, r, W, D);
    return { ...f, x: c.x - f.w / 2, y: c.y - f.d / 2, angle: (f.angle + 90 * r) % 360 };
  }
  switch (r) {
    case 1:  return { ...f, x: f.y,             y: W - f.x - f.w, w: f.d, d: f.w };
    case 2:  return { ...f, x: W - f.x - f.w,   y: D - f.y - f.d, w: f.w, d: f.d };
    case 3:  return { ...f, x: D - f.y - f.d,   y: f.x,           w: f.d, d: f.w };
    default: return { ...f };
  }
}

// Back→front render order of rooms for the home (dollhouse) view.
//
// Furniture is grouped and drawn one whole room at a time, in this order, so a
// piece in a nearer room always draws over a piece in a farther one. That sweeps
// away the cross-room occlusion cycles you get from one global furniture sort:
// at a shared wall, two rooms' pieces interlock and no single flat order is
// correct, so something pokes through. Per-room grouping sidesteps that — only
// pieces *within* a room compete geometrically, and rooms rarely overlap in a
// way that a clean back→front order can't express.
//
// Order key = explicit `room.homeOrder` if the user has set one (via the room
// editor's Home-view-layer buttons), else the room's geometric depth (centroid
// x+y). Smaller = farther back = drawn first. Once any room is hand-ordered the
// editor stamps every room with a contiguous integer, so the two key types never
// mix in practice.
function homeRoomOrder(rooms) {
  const key = r => r.homeOrder != null
    ? r.homeOrder
    : (r.points ? (centroid(r.points).x + centroid(r.points).y) : ((r.x || 0) + (r.y || 0)));
  return [...rooms].sort((a, b) => key(a) - key(b));
}

// ──────────────────────────────────────────────────────────────
// HOME · dollhouse apartment view
// ──────────────────────────────────────────────────────────────

// ─── Home-view walls ──────────────────────────────────────────────────────────
// The home view drew no walls at all; every divider was a hand-placed furniture
// slab, which meant building architecture around the furniture already in a
// room. These helpers generate them instead.
const AUTO_WALL_H = 3.5;    // fallback only; THEME.wallHeight is the live value

// Wall thickness and lightness are live knobs on the theme (⋮ → Customize →
// Debug) so they can be tuned against the real apartment instead of by editing
// a constant and reloading. Thickness 0 means a flat plane with no top strip.
function autoWallT() { return (THEME && THEME.wallThickness) || 0; }
function autoWallH() { return (THEME && THEME.wallHeight) || AUTO_WALL_H; }

// Classify a room's polygon edges in WORLD space (the home view has one fixed
// camera, so no rotation). RoomScene keeps its own local+rotated variant: it
// works in bbox-relative coordinates that have to line up with furniture, and
// squaring the two frames costs more than this small overlap.
//   isBack — edge lies deeper than the room's centroid, i.e. faces away
//   shared — another room sits on the far side
function classifyRoomEdges(room, allRooms) {
  const pts = room && room.points;
  if (!pts || pts.length < 3) return [];
  const others = allRooms.filter(r => r.id !== room.id && !!r.points);
  const c = centroid(pts);
  const n = pts.length;
  return pts.map((p, i) => {
    const next = pts[(i + 1) % n];
    const mx = (p.x + next.x) / 2, my = (p.y + next.y) / 2;
    const dx = next.x - p.x, dy = next.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const EPS = 0.05;
    const a = { x: mx + (dy / len) * EPS, y: my + (-dx / len) * EPS };
    const b = { x: mx - (dy / len) * EPS, y: my - (-dx / len) * EPS };
    const outside = pointInPolygon(a, pts) ? b : a;
    const neighbor = others.find(or => pointInPolygon(outside, or.points)) || null;
    return {
      i, p1: p, p2: next, len, neighbor,
      isBack: (c.x + c.y) > (mx + my),
      shared: !!neighbor,
      depth: c.x + c.y,
    };
  });
}

// Should this edge carry a wall in the home view? An explicit homeWalls entry
// wins; otherwise the rules below.
//
// Unlike RoomScene this does NOT require `!shared` — a room there reads as open
// to its neighbours, whereas here the shared edges are exactly the interior
// dividers we want. Each divider must therefore be drawn by exactly one of the
// two rooms that touch it, and the owner is the one IN FRONT of it (greater
// centroid depth): the home view draws rooms back→front, so the wall then lands
// after the far room's furniture and before the near room's, which is the
// correct layering.
//
// `isBack` alone almost does this — for most edges it is true for exactly one
// of the pair — but it fails on edges running ALONG the view axis, where both
// centroids can sit deeper than the midpoint and the divider gets drawn twice
// (measured: 2 of 61). So ownership is explicit, with an id tiebreak for the
// exactly-equal case.
function homeWallShown(room, edge) {
  const ov = room.homeWalls && room.homeWalls[edge.i];
  if (ov !== undefined) return !!ov;
  if (!edge.neighbor) return edge.isBack;          // exterior edge
  const mine = edge.depth;
  const theirs = (() => { const c = centroid(edge.neighbor.points); return c.x + c.y; })();
  if (Math.abs(mine - theirs) > 1e-6) return mine > theirs;
  return String(room.id) < String(edge.neighbor.id);
}

// Distance from a point to a segment, and the parametric position along it.
function _projT(px, py, e) {
  const dx = e.p2.x - e.p1.x, dy = e.p2.y - e.p1.y;
  const L2 = dx * dx + dy * dy || 1;
  return ((px - e.p1.x) * dx + (py - e.p1.y) * dy) / L2;
}
function _distToEdge(px, py, e) {
  const t = Math.max(0, Math.min(1, _projT(px, py, e)));
  return Math.hypot(px - (e.p1.x + t * (e.p2.x - e.p1.x)),
                    py - (e.p1.y + t * (e.p2.y - e.p1.y)));
}

// Door openings per edge, as [t0, t1] spans. An explicit `room.doors` wins;
// otherwise they are derived from furniture the user labelled Door / Sliding
// Door — that marking is more accurate than any heuristic placement, and
// deriving it means the doors already drawn in each room become the openings
// with no migration step. Editing a door in the room editor materialises
// `room.doors`, which then takes over.
function roomDoorSpans(room, edges) {
  if (room.doors) {
    const out = {};
    for (const k of Object.keys(room.doors)) {
      const d = room.doors[k];
      if (!d) continue;
      const half = (d.width || 3) / 2 / (edges[k] ? edges[k].len || 1 : 1);
      out[k] = [[Math.max(0, (d.pos ?? 0.5) - half), Math.min(1, (d.pos ?? 0.5) + half)]];
    }
    return out;
  }
  const origin = bbox(room.points);
  const spans = {};
  for (const f of (HOME_FURNITURE[room.id] || [])) {
    if (!/door/i.test(f.label || '')) continue;
    if ((f.h || 0) < 2) continue;          // the handle is its own short piece
    // Corners of the piece as it actually sits — a door in an off-square room
    // may be turned, and its opening should follow the wall it leans on.
    const corners = footprintCorners(origin.x + f.x, origin.y + f.y, f.w || 0, f.d || 0, f.angle || 0);
    const cx = (corners[0][0] + corners[2][0]) / 2, cy = (corners[0][1] + corners[2][1]) / 2;
    let best = -1, bestD = Infinity;
    edges.forEach((e, i) => {
      const dd = _distToEdge(cx, cy, e);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    if (best < 0 || bestD > 1.2) continue; // not sitting against a wall
    const e = edges[best];
    const ts = corners.map(([px, py]) => _projT(px, py, e));
    const t0 = Math.max(0, Math.min(...ts)), t1 = Math.min(1, Math.max(...ts));
    if (t1 > t0) (spans[best] = spans[best] || []).push([t0, t1]);
  }
  return spans;
}

// [0,1] minus the door spans — the solid stretches actually drawn.
function solidSpans(cuts) {
  const sorted = (cuts || []).slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  let t = 0;
  for (const [a, b] of sorted) {
    if (a > t) out.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < 1) out.push([t, 1]);
  return out;
}

// Slab quads for ONE edge, split around its door openings.
//
// A wall is a slab, not a plane: a flat quad reads as paper at this scale,
// which is why the hand-placed walls this replaces were boxes. We draw the
// face on the room-interior side plus the top strip, and the top is what sells
// the thickness.
//
// `c` must be the room centroid in the SAME frame as p1/p2 — the normal has to
// point into the room, and the two scenes work in different frames: the home
// view in world coords, the room view in rotated room-local ones.
function wallSlabs(p1, p2, c, spans, keyPrefix) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  if ((p1.x + nx - c.x) ** 2 + (p1.y + ny - c.y) ** 2 >
      (p1.x - nx - c.x) ** 2 + (p1.y - ny - c.y) ** 2) { nx = -nx; ny = -ny; }
  const T = autoWallT(), H = autoWallH();
  const lerp = t => ({ x: p1.x + dx * t, y: p1.y + dy * t });
  const out = [];
  solidSpans(spans).forEach(([t0, t1], k) => {
    if ((t1 - t0) * len < 0.02) return;
    const a = lerp(t0), b = lerp(t1);
    const ai = { x: a.x + nx * T, y: a.y + ny * T };
    const bi = { x: b.x + nx * T, y: b.y + ny * T };
    out.push({
      key: `${keyPrefix}-${k}`,
      // Outward normal of the face we draw, so the light can treat a wall the
      // same as any box face — walls running different ways now shade apart
      // instead of all sharing one flat tint.
      faceAz: Math.atan2(ny, nx) * 180 / Math.PI,
      face: isoPath([[ai.x, ai.y, 0], [bi.x, bi.y, 0], [bi.x, bi.y, H], [ai.x, ai.y, H]]),
      top: T > 0
        ? isoPath([[a.x, a.y, H], [b.x, b.y, H], [bi.x, bi.y, H], [ai.x, ai.y, H]])
        : null,
    });
  });
  return out;
}

// Home-view walls for a room, in world coords.
function homeWallPaths(room, allRooms) {
  const edges = classifyRoomEdges(room, allRooms);
  const doors = roomDoorSpans(room, edges);
  const c = centroid(room.points);
  const out = [];
  edges.forEach(e => {
    if (!homeWallShown(room, e)) return;
    out.push(...wallSlabs(e.p1, e.p2, c, doors[e.i], `${room.id}-w${e.i}`));
  });
  return out;
}

function HomeScene({ hoverRoom, onHover, onEnterRoom }) {
  const { width: W, depth: D, rooms } = APARTMENT;
  const PLATFORM_H = 0.6;

  // Polygon floor path for a room at floor height (z = 0).
  const floorPath = r => isoPath(r.points.map(p => [p.x, p.y, 0]));

  return (
    <g>
      {/* Apartment platform — single elevated slab */}
      <Box x={-1.5} y={-1.5} w={W + 3} d={D + 3} h={PLATFORM_H}
        color={THEME.slab} stroke="rgba(60,40,20,0.3)" strokeWidth={0.8} />

      <g transform={`translate(0, ${-PLATFORM_H * ISO.S})`}>
        {/* Per-room polygon floors. groupId still supported but no special stroke handling. */}
        {rooms.map(r => {
          const key = r.groupId || r.id;
          const isHover = hoverRoom === key;
          const base = themeFloor(r);
          const color = isHover ? shade(base, +12) : base;
          return (
            <path key={r.id} d={floorPath(r)} fill={color}
              stroke="rgba(60,40,20,0.45)" strokeWidth={0.6} strokeLinejoin="round" />
          );
        })}

        {/* Furniture, one room at a time, rooms ordered back→front (see
            homeRoomOrder). Within a room, sort at the default view angle (rot 0)
            so the home view matches the order arranged for the room's default
            rotation — independent of any custom order set for other angles.
            Local (x,y) → world coords via the room's bbox origin. */}
        {homeRoomOrder(rooms).flatMap(r => {
          const origin = r.points ? bbox(r.points) : { x: r.x || 0, y: r.y || 0 };
          const furn = (HOME_FURNITURE[r.id] || []).map(f => ({
            ...f, x: origin.x + f.x, y: origin.y + f.y, roomId: r.id,
          }));
          // Auto walls first: only back-facing edges are drawn by default, and
          // those sit behind everything in the room. `noInteract` rooms are the
          // wall infills themselves, so they get none.
          const wallFill = themeWall(themeFloor(r));
          const walls = (r.points && !r.noInteract)
            ? homeWallPaths(r, rooms).flatMap(w => [
                <path key={w.key + 'f'} d={w.face} fill={shade(wallFill, faceShadeAt(w.faceAz))}
                  stroke="rgba(60,40,20,0.5)" strokeWidth={0.7} strokeLinejoin="round" />,
                w.top ? (
                  <path key={w.key + 't'} d={w.top} fill={shade(wallFill, faceShade('top'))}
                    stroke="rgba(60,40,20,0.5)" strokeWidth={0.7} strokeLinejoin="round" />
                ) : null,
              ].filter(Boolean))
            : [];
          return walls.concat(isoDepthSort(furn, 0).map(f => (
            <Box key={f.id} x={f.x} y={f.y} z={f.z || 0} w={f.w} d={f.d} h={f.h}
              color={f.color} shape={f.shape} angle={f.angle || 0}
              stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} />
          )));
        })}

        {/* Per-room hover hit zones (polygon). Walls / non-interactive rooms skipped. */}
        {rooms.filter(r => !r.noInteract).map(r => {
          const key = r.groupId || r.id;
          return (
            <RoomHitZone key={'h' + r.id} room={r}
              hovered={hoverRoom === key}
              onHover={() => onHover(key)}
              onLeave={() => onHover(null)}
              onClick={() => onEnterRoom(key)} />
          );
        })}

        {/* Room labels intentionally omitted — re-add once rooms have inventory. */}
      </g>
    </g>
  );
}

// Invisible hit-zone over a room — captures hover/click.
// Supports polygon (room.points) or rectangle (room.x/y/w/d) rooms.
function RoomHitZone({ room, hovered, onHover, onLeave, onClick }) {
  const pts = room.points
    ? room.points.map(p => [p.x, p.y, 0.01])
    : [
        [room.x, room.y, 0.01], [room.x + room.w, room.y, 0.01],
        [room.x + room.w, room.y + room.d, 0.01], [room.x, room.y + room.d, 0.01],
      ];
  const path = isoPath(pts);
  return (
    <path d={path}
      fill={hovered ? 'rgba(255,210,138,0.18)' : 'transparent'}
      stroke={hovered ? PALETTE.glow.primary : 'transparent'}
      strokeWidth="1.5"
      style={{ cursor: onClick ? 'pointer' : 'default', transition: 'fill .15s' }}
      onMouseEnter={onHover} onMouseLeave={onLeave} onClick={onClick} />
  );
}

// Resolve a per-edge wall override for a given view angle. Walls can be forced
// on/off independently at each rotation, stored as
// `room.wallOverrides[rot][edgeIdx] = boolean` (rot = 0–3 quarter-turns). A
// legacy flat shape `room.wallOverrides[edgeIdx] = boolean` (no rotation key,
// applied to every angle) is still honored as a fallback for any (rot, edge)
// without its own per-angle entry. Returns true (force wall), false (force none),
// or undefined (fall back to the back-facing heuristic). Override *values* are
// always booleans and per-angle *values* are always objects, so the two shapes
// are told apart by value type even though their small-integer keys overlap.
function wallOverrideFor(room, rot, i) {
  const wo = room && room.wallOverrides;
  if (!wo) return undefined;
  const perRot = wo[rot];
  if (perRot && typeof perRot === 'object' && i in perRot) return perRot[i];
  if (typeof wo[i] === 'boolean') return wo[i];   // legacy flat (all angles)
  return undefined;
}

// ──────────────────────────────────────────────────────────────
// ROOM · single-room view with glowing storage outlines
// ──────────────────────────────────────────────────────────────

function RoomScene({ roomId, hoverArea, onHoverArea, onPickArea, selectedArea, rot = 0 }) {
  const room = APARTMENT.rooms.find(r => r.id === roomId);
  if (!room) return null;
  // Derive shape: polygon if available, else rectangle from w/d.
  const isPolygon = !!room.points;
  const bb = isPolygon ? bbox(room.points) : { x: 0, y: 0, w: room.w, d: room.d };
  const rw = room.w ?? bb.w;
  const rd = room.d ?? bb.d;
  const W = bb.w, D = bb.d;
  // Room-local outline (origin at bbox top-left so furniture coords line up).
  const baseOutline = isPolygon
    ? room.points.map(p => ({ x: p.x - bb.x, y: p.y - bb.y }))
    : [{ x: 0, y: 0 }, { x: rw, y: 0 }, { x: rw, y: rd }, { x: 0, y: rd }];
  // Rotated outline drives all geometry/projection below.
  const outline = baseOutline.map(p => rotPoint(p.x, p.y, rot, W, D));
  const c = centroid(outline);
  // Classify each edge: back-facing (toward iso back) vs front-facing, and
  // shared (borders another room) vs exterior. Only back-facing AND exterior
  // edges get a cutaway wall — interior walls between rooms are skipped so
  // the room appears open to its neighbors.
  // `shared` is camera-independent → computed from the *unrotated* world
  // geometry (against neighbor polygons). `isBack` is camera-dependent →
  // computed from the rotated outline. Edge index `i` aligns between the two
  // (rotation moves points but preserves their order), so wallOverrides[i]
  // stays valid across rotations.
  const others = APARTMENT.rooms.filter(r => r.id !== roomId && !!r.points);
  const n = baseOutline.length;
  const edges = baseOutline.map((p, i) => {
    const next = baseOutline[(i + 1) % n];
    const mx = (p.x + next.x) / 2, my = (p.y + next.y) / 2;
    // World-space midpoint nudged just outside the current room, used to test
    // whether another room sits on the far side of this edge.
    const dx = next.x - p.x, dy = next.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const EPS = 0.05;
    const wmx = mx + bb.x, wmy = my + bb.y;
    const a = { x: wmx + (dy / len) * EPS, y: wmy + (-dx / len) * EPS };
    const b = { x: wmx - (dy / len) * EPS, y: wmy - (-dx / len) * EPS };
    let shared = false;
    if (isPolygon) {
      const outside = pointInPolygon(a, room.points) ? b : a;
      shared = others.some(or => pointInPolygon(outside, or.points));
    }
    // Rotated edge endpoints + midpoint for rendering and the back-face test.
    const rp = outline[i], rnext = outline[(i + 1) % n];
    const rmx = (rp.x + rnext.x) / 2, rmy = (rp.y + rnext.y) / 2;
    return { p1: rp, p2: rnext, isBack: (c.x + c.y) > (rmx + rmy), shared };
  });

  const furn = (HOME_FURNITURE[roomId] || []).map(f => rotRect(f, rot, W, D));
  const areas = STORAGE_AREAS[roomId] || [];
  const PLATFORM_H = 0.5;
  const floorColor = themeFloor(room);
  const wallColor  = themeWall(floorColor);

  // Floor path at z=0 (room-local). Platform top sits at the same z; we render
  // its visible front faces underneath the floor for the "plinth" look.
  const floorPathD = isoPath(outline.map(p => [p.x, p.y, 0]));

  return (
    <g>
      {/* Polygon platform — top face + front-facing side panels (the visible
          edge of the slab the room sits on). */}
      <path d={isoPath(outline.map(p => [p.x, p.y, -0.001]))}
        fill={themePlinth()} stroke="rgba(60,40,20,0.35)" strokeWidth={0.6} strokeLinejoin="round" />
      {edges.filter(e => !e.isBack).map((e, i) => (
        <path key={'pl' + i}
          d={isoPath([
            [e.p1.x, e.p1.y, -PLATFORM_H], [e.p2.x, e.p2.y, -PLATFORM_H],
            [e.p2.x, e.p2.y, 0],           [e.p1.x, e.p1.y, 0],
          ])}
          fill={shade(themePlinth(), -22)}
          stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
      ))}

      <g>
        {/* Floor */}
        <path d={floorPathD} fill={floorColor}
          stroke="rgba(60,40,20,0.3)" strokeWidth={0.5} strokeLinejoin="round" />

        {/* Walls — the SAME set the home view draws, so adjusting them here is
            WYSIWYG against the dollhouse instead of a round trip out and back.
            Which edges get a wall is decided in world space (camera-independent);
            they are drawn here in the room's rotated local frame, which works
            because edge index i is aligned between the two — the same alignment
            wallOverrides has always relied on.
            Sorted back-to-front by base depth so a nearer wall never hides
            behind a farther one where they meet at a corner. */}
        {(() => {
          const worldEdges = classifyRoomEdges(room, APARTMENT.rooms);
          const doors = roomDoorSpans(room, worldEdges);
          return edges
            .map((e, i) => ({ e, i }))
            .filter(({ i }) => worldEdges[i] && homeWallShown(room, worldEdges[i]))
            .sort((A, B) =>
              (A.e.p1.x + A.e.p1.y + A.e.p2.x + A.e.p2.y) -
              (B.e.p1.x + B.e.p1.y + B.e.p2.x + B.e.p2.y))
            .flatMap(({ e, i }) => wallSlabs(e.p1, e.p2, c, doors[i], 'w' + i))
            .flatMap(w => [
              <path key={w.key + 'f'} d={w.face} fill={shade(wallColor, faceShadeAt(w.faceAz))}
                stroke="rgba(60,40,20,0.5)" strokeWidth={0.7} strokeLinejoin="round" />,
              w.top ? (
                <path key={w.key + 't'} d={w.top} fill={shade(wallColor, faceShade('top'))}
                  stroke="rgba(60,40,20,0.5)" strokeWidth={0.7} strokeLinejoin="round" />
              ) : null,
            ].filter(Boolean));
        })()}

        {/* Furniture, depth-sorted for the current view angle */}
        {isoDepthSort(furn, rot).map(f => {
          const areaForFurn = areas.find(a => a.furniture === f.id);
          if (!areaForFurn) {
            return (
              <Box key={f.id} x={f.x} y={f.y} z={f.z || 0} w={f.w} d={f.d} h={f.h}
                color={f.color} shape={f.shape} angle={f.angle || 0}
                stroke="rgba(60,40,20,0.4)" strokeWidth={0.6}
                style={{ pointerEvents: 'none' }} />
            );
          }
          const isHover = hoverArea === areaForFurn?.id;
          const isSel   = selectedArea === areaForFurn?.id;
          const glowColor = isSel ? '#ff9040' : isHover ? PALETTE.glow.primary : null;
          return (
            <FurniturePiece key={f.id} f={f} glow={glowColor}
              storageAreas={areas.filter(a => a.furniture === f.id)}
              hoverArea={hoverArea} selectedArea={selectedArea}
              onHoverArea={onHoverArea} onPickArea={onPickArea} />
          );
        })}

        {/* No resting marker above storage pieces: the dashed outline on the
            face already says a piece holds things, and a floating dot on every
            one of them just crowds the room. */}

        {/* Active container's label, LAST so it clears every piece in front of
            it. Drawn with its furniture it would be occluded by anything nearer
            the camera — most visibly for containers at the back of the room. */}
        {areas.map(a => {
          if (hoverArea !== a.id && selectedArea !== a.id) return null;
          const f = furn.find(x => x.id === a.furniture);
          if (!f) return null;
          return <AreaLabel key={'lb' + a.id} f={f} a={a} selected={selectedArea === a.id} />;
        })}
      </g>
    </g>
  );
}

// Renders one piece of furniture with glowing storage outlines (overlay C).
function FurniturePiece({ f, glow, storageAreas, hoverArea, selectedArea, onHoverArea, onPickArea }) {
  const fz = f.z || 0;
  const ang = f.angle || 0;
  const isCircle = f.shape === 'circle';
  const cyl = isCircle ? cylinderFaces(f.x, f.y, fz, f.w, f.d, f.h, 28, ang) : null;
  // An angled piece has no fixed "right"/"front" face, so it is drawn from the
  // faces that actually point at the camera (see prismFaces).
  const prism = (!isCircle && ang) ? prismFaces(f.x, f.y, fz, f.w, f.d, f.h, ang) : null;
  const faces = (isCircle || prism) ? null : boxFaces(f.x, f.y, fz, f.w, f.d, f.h);
  const top   = shade(f.color, faceShade('top'));
  const right = shade(f.color, faceShade('right'));
  const front = shade(f.color, faceShade('front'));
  // Whichever visible face of an angled piece points most nearly the way the
  // named face would — so a container's "front" glow still lands on the side
  // you are looking at. A 45° piece shows only one side (the others are
  // edge-on), so both names can resolve to it; with none visible, the cap.
  const nearestSide = az => {
    if (!prism || !prism.sides.length) return null;
    const dist = s => { const t = Math.abs(s.az - az) % 360; return t > 180 ? 360 - t : t; };
    return prism.sides.reduce((a, b) => (dist(b) < dist(a) ? b : a)).d;
  };
  // Face used by storage-area glow outlines. For circles the side wall is built
  // from many quads (stroking it would show seams), so use the clean cap ellipse
  // for both top and front glows.
  const topFace    = isCircle ? cyl.top : prism ? prism.top : faces.top;
  const frontFace  = isCircle ? cyl.top : prism ? (nearestSide(90) || prism.top) : faces.front;
  const front2Face = isCircle ? cyl.top : prism ? (nearestSide(0)  || prism.top) : faces.right;

  // Pick the primary area for the whole-piece glow color
  const primaryActive = storageAreas.find(a => a.id === selectedArea) || storageAreas.find(a => a.id === hoverArea);
  const glowColor = primaryActive ? (selectedArea === primaryActive.id ? '#ff9040' : '#ffd28a') : null;
  const filter = glowColor ? `drop-shadow(0 0 4px ${glowColor}) drop-shadow(0 0 10px ${glowColor})` : undefined;

  return (
    <g style={{ filter, transition: 'filter .18s' }}>
      {isCircle ? (
        <>
          <path d={cyl.body} fill={shade(f.color, -16)} stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
          <path d={cyl.top}  fill={top}                 stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
        </>
      ) : prism ? (
        <>
          {prism.sides.map((s, i) => (
            <path key={'s' + i} d={s.d} fill={shade(f.color, faceShadeAt(s.az))}
              stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
          ))}
          <path d={prism.top} fill={top} stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d={faces.front} fill={front} stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
          <path d={faces.right} fill={right} stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
          <path d={faces.top}   fill={top}   stroke="rgba(60,40,20,0.4)" strokeWidth={0.6} strokeLinejoin="round" />
        </>
      )}

      {/* Storage-area glowing outlines + hit zones */}
      {storageAreas.map(a => {
        const facePath = a.face === 'top' ? topFace : a.face === 'front2' ? front2Face : frontFace;
        const isHover = hoverArea === a.id;
        const isSel   = selectedArea === a.id;
        const outlineColor = isSel ? '#ffb060' : isHover ? '#ffe2a0' : 'rgba(255,210,138,.55)';
        const strokeWidth = isSel ? 2.5 : isHover ? 2 : 1.4;
        return (
          <path key={a.id} d={facePath}
            fill="transparent"
            stroke={outlineColor}
            strokeWidth={strokeWidth}
            strokeDasharray={isHover || isSel ? '0' : '3 2'}
            style={{ cursor: 'pointer', transition: 'stroke .15s, stroke-width .15s', pointerEvents: 'all' }}
            onMouseEnter={() => onHoverArea(a.id)}
            onMouseLeave={() => onHoverArea(null)}
            onClick={(e) => { e.stopPropagation(); onPickArea(a.id); }} />
        );
      })}

    </g>
  );
}

// The label for the hovered/selected container. Rendered by RoomScene in a
// final pass rather than inside FurniturePiece: the pieces are depth-sorted, so
// a label drawn with its own piece is painted over by anything in front of it —
// which is exactly the container you are pointing at when it sits at the back.
function AreaLabel({ f, a, selected }) {
  const [sx, sy] = proj(f.x + f.w / 2, f.y + f.d / 2, (f.z || 0) + f.h + 1);
  return (
    <g transform={`translate(${sx},${sy})`} style={{ pointerEvents:'none' }}>
      <rect x={-58} y={-18} rx={4} ry={4} width={116} height={20}
        fill="#3a2a1e" stroke={selected ? '#ff9040' : '#ffd28a'} strokeWidth="1" />
      <text textAnchor="middle" y={-9} fontFamily="Inter, system-ui, sans-serif"
        fontSize="9" fontWeight="600" fill="#fff7e0">{a.label}</text>
      <text textAnchor="middle" y={-1} fontFamily="JetBrains Mono, monospace"
        fontSize="7" fill="rgba(255,247,224,.7)">
        {itemCount(a)} items{a.lowStock ? ' · LOW' : ''}
      </text>
    </g>
  );
}

Object.assign(window, { HomeScene, RoomScene, AreaLabel, classifyRoomEdges, homeWallShown, roomDoorSpans, homeWallPaths, wallSlabs, AUTO_WALL_H, autoWallT, autoWallH, FurniturePiece, sortByDepth, isoDepthSort, rotPoint, rotRect, homeRoomOrder, wallOverrideFor });
