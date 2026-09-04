// ─── iso.jsx ───
// Isometric rendering primitives for the apartment/room views.
// World coords: x→ right-back, y→ front, z→ up.
// Screen coords: standard SVG (y down).

const ISO = {
  S: 11,               // world unit → pixels
  // Camera elevation. 0.5 is standard 2:1 isometric; higher looks down on the
  // apartment from further above, lower flattens toward an edge-on view. App
  // mirrors THEME.tilt onto this each render, the same way it mirrors APARTMENT.
  TILT: 0.5,
  get tw() { return this.S * 2; },     // tile width on screen
  get th() { return this.S; },          // tile depth on screen
};

// Project world (x, y, z) → screen (sx, sy).
// Only the ground plane is foreshortened by TILT; z keeps a fixed scale so
// raising the camera does not also change how tall everything is.
function proj(x, y, z = 0) {
  return [(x - y) * ISO.S, (x + y) * ISO.S * ISO.TILT - z * ISO.S];
}

// Helper: turn an array of [x,y,z] world points into an SVG path "M…L…Z"
function isoPath(pts) {
  return pts.map((p, i) => {
    const [sx, sy] = proj(p[0], p[1], p[2] || 0);
    return (i === 0 ? 'M' : 'L') + sx.toFixed(1) + ',' + sy.toFixed(1);
  }).join(' ') + ' Z';
}

// Color helpers
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Same hex as an `rgba()` string at the given alpha. Needed wherever a themed
// colour has to sit translucently over the scene — the top bar's fade is the
// one case today, and it can't use `shade` because it needs transparency.
function rgbaOf(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

// ─── Lighting ────────────────────────────────────────────────────────────────
// Face shading used to be three hardcoded deltas (top +18, right 0, front -22).
// They are a directional light now, and the defaults below reproduce those
// numbers exactly, so turning this on changes nothing until a knob moves.
//
//   azimuth   where the light comes from, in the same frame as face normals:
//             0 = the +x ("right") face, 90 = the +y ("front") face.
//   intensity spread between the brightest and darkest vertical face.
//   sky       how much brighter horizontal (top) faces are; the light is
//             overhead in an isometric scene, so this is its own term rather
//             than falling out of the azimuth.
//   ambient   lifts or drops everything together.
//
// 270° puts the light behind-right, which is what produces right=0, front=-22.
const LIGHT = { azimuth: 270, intensity: 22, sky: 18, ambient: 0 };

// Shade delta for a surface whose outward normal points at `aDeg`.
function faceShadeAt(aDeg) {
  return LIGHT.ambient + LIGHT.intensity * Math.cos((LIGHT.azimuth - aDeg) * Math.PI / 180);
}

// Shade delta for a named box face. 'side' is the average orientation of a
// cylinder's visible curve, which lands on the -16 cylinders used before.
const FACE_AZIMUTH = { right: 0, front: 90, left: 180, back: 270, side: 45 };
function faceShade(face) {
  if (face === 'top') return LIGHT.ambient + LIGHT.sky;
  return faceShadeAt(FACE_AZIMUTH[face] !== undefined ? FACE_AZIMUTH[face] : 0);
}

// Faces helper for a Box. Returns { top, right, front } face shapes.
function boxFaces(x, y, z, w, d, h) {
  return {
    top:   isoPath([[x, y, z+h], [x+w, y, z+h], [x+w, y+d, z+h], [x, y+d, z+h]]),
    right: isoPath([[x+w, y, z+h], [x+w, y, z], [x+w, y+d, z], [x+w, y+d, z+h]]),
    front: isoPath([[x, y+d, z+h], [x+w, y+d, z+h], [x+w, y+d, z], [x, y+d, z]]),
  };
}

// ─── Angled footprints ───────────────────────────────────────────────────────
// A piece may carry `angle` — degrees clockwise about its own footprint centre,
// in plan coords (x right, y front/down). Rooms like the storage nook and the
// hallway don't meet at right angles, so the furniture in them doesn't either.
//
// x/y/w/d keep describing the *unrotated* footprint, and rotation is applied
// about its centre — which is rotation-invariant, so the anchor stays put and
// every centre-based helper (labels, shadows) keeps working untouched. Angles
// that land on a multiple of 90° are baked back into w/d by the editor, so
// `angle` only ever appears on genuinely diagonal pieces and every existing
// axis-aligned path stays on its original, cheaper code path.

// The four footprint corners, in winding order, rotated about the centre.
function footprintCorners(x, y, w, d, angle = 0) {
  const pts = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  if (!angle) return pts;
  const t = angle * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  const cx = x + w / 2, cy = y + d / 2;
  return pts.map(([px, py]) => {
    const dx = px - cx, dy = py - cy;
    return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs];
  });
}

// Axis-aligned bounds of that rotated footprint, in the same {x,y,w,d} shape a
// piece uses. Everything that needs a rectangle for an angled piece — the
// depth sort, marquee hit tests, selection boxes — goes through this.
function footprintBounds(x, y, w, d, angle = 0) {
  if (!angle) return { x, y, w, d };
  const c = footprintCorners(x, y, w, d, angle);
  const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, d: Math.max(...ys) - y0 };
}

// Faces of a rotated box: the top cap plus whichever vertical faces point at
// the camera. Each side carries the azimuth of its outward normal, so it shades
// through the same directional light as an axis-aligned face rather than
// needing a name from FACE_AZIMUTH. At angle 0 this yields exactly the `right`
// (az 0) and `front` (az 90) faces boxFaces draws, with identical shading.
//
// Camera visibility: the camera looks from the +x,+y side, so a face shows when
// nx + ny > 0 — the same test cylinderFaces uses for its side quads. A box
// turned exactly 45° therefore shows one vertical face, its two neighbours
// being edge-on, which is what that box really looks like from this angle.
function prismFaces(x, y, z, w, d, h, angle = 0) {
  const c = footprintCorners(x, y, w, d, angle);
  const top = isoPath(c.map(p => [p[0], p[1], z + h]));
  const sides = [];
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    const nx = q[1] - p[1], ny = p[0] - q[0];   // outward normal of edge p→q
    if (nx + ny <= 1e-9) continue;              // faces away, or edge-on
    sides.push({
      d: isoPath([[p[0], p[1], z + h], [q[0], q[1], z + h], [q[0], q[1], z], [p[0], p[1], z]]),
      az: (Math.atan2(ny, nx) * 180 / Math.PI + 360) % 360,
    });
  }
  return { top, sides };
}

// Faces helper for a cylinder/elliptical column inscribed in the same w×d×h
// footprint a Box would use (x,y = min corner). Returns { top, body } SVG path
// strings: `top` is the elliptical cap, `body` the front-facing side wall.
// Because proj() is affine, a world-space ellipse maps to a screen ellipse and
// the z-offset is purely vertical, so we sample the footprint ellipse, project
// it at the cap and base heights, and stitch the camera-facing side quads.
function cylinderFaces(x, y, z, w, d, h, n = 28, angle = 0) {
  const cx = x + w / 2, cy = y + d / 2, rw = w / 2, rd = d / 2;
  const ca = Math.cos(angle * Math.PI / 180), sa = Math.sin(angle * Math.PI / 180);
  const top = [], bot = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    // Ellipse point in the piece's own frame, then turned by `angle` about the
    // centre. A true circle (w === d) is unchanged by this, as it should be.
    const ex = rw * Math.cos(t), ey = rd * Math.sin(t);
    const wx = cx + ex * ca - ey * sa, wy = cy + ex * sa + ey * ca;
    top.push(proj(wx, wy, z + h));
    bot.push(proj(wx, wy, z));
  }
  const topD = top.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + ' Z';
  const step = (2 * Math.PI) / n;
  let bodyD = '';
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const tmid = i * step + step / 2;
    // Outward normal of the ellipse side ∝ (rd·cosθ, rw·sinθ), turned by the
    // same `angle` as the samples. The camera looks from the +x,+y side, so a
    // face is visible when nx + ny > 0.
    const ox = rd * Math.cos(tmid), oy = rw * Math.sin(tmid);
    if ((ox * ca - oy * sa) + (ox * sa + oy * ca) > 0) {
      bodyD += `M${top[i][0].toFixed(1)},${top[i][1].toFixed(1)} L${top[j][0].toFixed(1)},${top[j][1].toFixed(1)} `
            +  `L${bot[j][0].toFixed(1)},${bot[j][1].toFixed(1)} L${bot[i][0].toFixed(1)},${bot[i][1].toFixed(1)} Z `;
    }
  }
  return { top: topD, body: bodyD };
}

// Box — a solid cuboid (or, with shape='circle', an elliptical column) drawn as
// lit faces. color is a base hex; faces are shaded automatically.
function Box({ x, y, z = 0, w, d, h, color, shape, angle = 0, stroke = 'rgba(60,40,20,0.35)', strokeWidth = 0.6, glow = null, label = null, onClick, hover, style }) {
  const filter = glow ? `drop-shadow(0 0 6px ${glow}) drop-shadow(0 0 12px ${glow})` : undefined;
  const cursor = onClick ? 'pointer' : undefined;
  if (shape === 'circle') {
    const f = cylinderFaces(x, y, z, w, d, h, 28, angle);
    return (
      <g onClick={onClick} style={{ cursor, transition:'filter .2s', filter, ...style }}>
        <path d={f.body} fill={shade(color, faceShade('side'))} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <path d={f.top}  fill={shade(color, faceShade('top'))} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
        {hover && hover}
        {label}
      </g>
    );
  }
  if (angle) {
    const p = prismFaces(x, y, z, w, d, h, angle);
    return (
      <g onClick={onClick} style={{ cursor, transition:'filter .2s', filter, ...style }}>
        {p.sides.map((s, i) => (
          <path key={'s' + i} d={s.d} fill={shade(color, faceShadeAt(s.az))}
            stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
        ))}
        <path d={p.top} fill={shade(color, faceShade('top'))} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
        {hover && hover}
        {label}
      </g>
    );
  }
  const faces = boxFaces(x, y, z, w, d, h);
  const top   = shade(color, faceShade('top'));
  const right = shade(color, faceShade('right'));
  const front = shade(color, faceShade('front'));
  return (
    <g onClick={onClick} style={{ cursor, transition:'filter .2s', filter, ...style }}>
      <path d={faces.front} fill={front} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d={faces.right} fill={right} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d={faces.top}   fill={top}   stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {hover && hover}
      {label}
    </g>
  );
}

// Floor — flat top face only (no walls) at z=0.
function Floor({ x, y, w, d, color, stroke = 'rgba(60,40,20,0.25)' }) {
  return (
    <path d={isoPath([[x, y, 0], [x+w, y, 0], [x+w, y+d, 0], [x, y+d, 0]])}
      fill={color} stroke={stroke} strokeWidth={0.5} />
  );
}

// Wall — a thin vertical box. orientation 'h' (along x) or 'v' (along y).
function Wall({ x, y, length, height = 8, thickness = 0.4, orientation = 'h', color = '#e7d6b8' }) {
  if (orientation === 'h') {
    return <Box x={x} y={y} w={length} d={thickness} h={height} color={color} />;
  } else {
    return <Box x={x} y={y} w={thickness} d={length} h={height} color={color} />;
  }
}

// Floor with subtle plank texture: floor + a few stripes.
function PlankFloor({ x, y, w, d, color, plankWidth = 2 }) {
  const planks = [];
  for (let px = x + plankWidth; px < x + w; px += plankWidth) {
    const [a0, a1] = proj(px, y, 0);
    const [b0, b1] = proj(px, y + d, 0);
    planks.push(<line key={px} x1={a0} y1={a1} x2={b0} y2={b1}
      stroke={shade(color, -15)} strokeWidth="0.4" opacity="0.5" />);
  }
  return (
    <g>
      <Floor x={x} y={y} w={w} d={d} color={color} />
      {planks}
    </g>
  );
}

// Sort children by isometric depth (x + y + z ascending = back first).
// Used to render objects in correct painter's order inside a room.
function depthOf(item) {
  return (item.x || 0) + (item.y || 0) + (item.z || 0);
}

// Soft elliptical drop-shadow under an object at floor level.
function GroundShadow({ x, y, w, d, opacity = 0.18 }) {
  const [cx, cy] = proj(x + w/2, y + d/2, 0);
  return <ellipse cx={cx} cy={cy + 1} rx={(w + d) * ISO.S * 0.5} ry={(w + d) * ISO.S * 0.25} fill="rgba(60,40,20,1)" opacity={opacity} />;
}

// Bounding box + centroid for a polygon (array of {x,y} points).
function bbox(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, d: Math.max(...ys) - y };
}
function centroid(points) {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

Object.assign(window, { ISO, LIGHT, faceShade, faceShadeAt, proj, isoPath, shade, rgbaOf, Box, Floor, Wall, PlankFloor, GroundShadow, boxFaces, cylinderFaces, prismFaces, footprintCorners, footprintBounds, depthOf, bbox, centroid });
