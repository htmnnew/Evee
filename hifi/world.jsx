// ─── world.jsx ───
// Apartment data: rooms (polygons), furniture inside each, and storage areas.
//
// Each room is a closed polygon: { id, name, color, points: [{x,y}, ...] }.
// Coords are in world units (≈ 1 foot). Apartment footprint is set by
// APARTMENT.width × APARTMENT.depth. (0,0) is the back-left corner in plan view.
//
// Default layout is seeded from home.json (authored in the floor-plan editor);
// the live layout lives server-side in state/plan.json.

const PALETTE = {
  bg:        '#efe1c6',
  bgShadow:  '#d9c39e',
  ink:       '#3a2a1e',
  ink2:      '#6b5440',
  furniture: {
    wood:    '#a87850',
    woodDk:  '#86583a',
    woodLt:  '#c8966a',
    fabric:  '#a8a890',
    fabricRed:'#b65840',
    fabricGn:'#849676',
    metal:   '#b8b8b8',
    white:   '#e8e2d6',
    cream:   '#e0d2b6',
    sage:    '#8a9a7b',
    terra:   '#c47358',
    fridge:  '#d8d2c2',
    plant:   '#5e7d4a',
  },
  glow: {
    primary: '#ffd28a',
    selected:'#ffaa55',
  },
};

// ─── Scene theme ──────────────────────────────────────────────
// The user-adjustable half of the palette: the surfaces the Customize drawer
// (⋮ → Customize) can repaint. Lives on `apt.theme` so it rides along with the
// layout through localStorage and Save/Load Plan; absent means "stock look".
//
// Nulls mean *derive*, not "no colour" — each has a rule below rather than a
// literal, so the derived surfaces keep tracking whatever they're based on:
//   bg     → the hand-tuned home gradient. Its three stops aren't uniformly
//            related, so deriving them from one base would shift the default
//            look for everyone; the literal stays until the user picks a colour.
//   floor  → each room's own colour. See themeFloor: a theme floor OVERRIDES
//            rooms rather than backfilling them, because every seeded room
//            already has a colour, which made a fallback unreachable.
//   wall   → shade(floor, wallShade), which is what rooms did before themes.
//   plinth → shade(slab, -12).
const DEFAULT_THEME = {
  bg:        null,
  floor:     null,
  wall:      null,
  wallShade: 25,
  slab:      '#d6c19e',
  plinth:    null,
  // Auto-wall shape (⋮ → Customize → Debug). Thickness 0 = flat plane.
  // Height is half the 7ft the room view used before walls were generated,
  // which is what lets you see over them into the room.
  wallThickness: 0,
  wallHeight:    3.5,
  // Directional light; see LIGHT in iso.jsx. These defaults reproduce the
  // shading that used to be hardcoded.
  lightAzimuth:   270,
  lightIntensity: 22,
  lightSky:       18,
  lightAmbient:   0,
  // Camera elevation; see ISO.TILT. 0.5 = standard 2:1 isometric.
  tilt:          0.5,
  // View scale. Tilting further top-down shrinks the apartment's screen
  // footprint, so the two knobs are almost always adjusted together.
  zoom:          1,
};

// Used only when a room has no colour AND the theme sets no floor.
const FALLBACK_FLOOR = '#beac98';

// The home gradient as it was before themes existed, used whenever bg is unset.
const STOCK_BG_GRADIENT =
  'radial-gradient(ellipse at 50% 55%, #fbecc8 0%, #e9d4a5 55%, #d4b87c 100%)';

// Resolved theme. App reassigns this each render (like APARTMENT) so scenes
// reading the bare identifier see live edits.
let THEME = { ...DEFAULT_THEME };

// A room's floor colour, and the one place that precedence lives.
//
// The theme floor deliberately OVERRIDES a room's own colour rather than
// filling in behind it. Every room in a seeded plan already carries a colour,
// so a fallback could never take effect — the Customize drawer's Floor picker
// would be a control that provably does nothing. Overriding keeps it live, and
// keeps it reversible: clear the theme floor and the per-room colours (the blue
// bathrooms, the near-white bedroom) come straight back, because they were
// never overwritten.
function themeFloor(room) {
  // Wall infills opt out. Their grey is structure, not decoration — the same
  // reason "Discard per-room colours" skips them — and washing the dividers in
  // the floor colour reads as the walls disappearing rather than as a theme.
  if (room && room.noInteract && room.color) return room.color;
  return THEME.floor || (room && room.color) || FALLBACK_FLOOR;
}

// Walls follow the floor unless given a colour of their own.
function themeWall(floorColor) {
  return THEME.wall || shade(floorColor, THEME.wallShade);
}

// The platform's front/side faces, a step darker than its top.
function themePlinth() {
  return THEME.plinth || shade(THEME.slab, -12);
}

let APARTMENT = {
  width: 37.25, depth: 34.55,
  rooms: [
    { id: 'bedroom1', name: 'Bedroom 1', color: '#f0ece2', viewRot: 0, wallOverrides: {"0": {"0": false, "5": true}, "1": {"5": true}, "2": {"5": true}, "3": {"5": true}}, points: [
     { x: 24.166666666666664, y: 0 }, { x: 37.25, y: 0 }, { x: 37.25, y: 14.083333333333332 },
     { x: 28.166666666666664, y: 14.083333333333332 }, { x: 28.166666666666664, y: 17.833333333333332 }, { x: 24.166666666666664, y: 17.833333333333332 },
    ]},
    { id: 'roommppocsb8', name: 'Patio', color: '#e2e1df', hideName: true, wallOverrides: {"0": {"0": false, "3": true}, "1": {"3": true}, "2": {"3": true}, "3": {"3": true}}, points: [
     { x: 15, y: 0 }, { x: 24.166666666666664, y: 0 }, { x: 24.166666666666664, y: 6.666666666666666 },
     { x: 15, y: 6.666666666666666 },
    ]},
    { id: 'roommppoe0wb', name: 'Living Room', color: '#beac98', viewRot: 0, wallOverrides: {"0": {"8": false}}, points: [
     { x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 6.666666666666666 },
     { x: 15, y: 6.666666666666666 }, { x: 15, y: 6.666666666666666 }, { x: 15, y: 6.583333333333333 },
     { x: 15, y: 13 }, { x: 14.916666666666666, y: 13 }, { x: 0, y: 13 },
    ]},
    { id: 'roommppoommb', name: 'Kitchen', color: '#beac98', viewRot: 3, wallOverrides: {"0": {"2": false}, "1": {"2": false}, "2": {"2": false}, "3": {"2": false, "3": false}}, points: [
     { x: 0, y: 13 }, { x: 15, y: 13 }, { x: 15, y: 22.583333333333332 },
     { x: 0, y: 22.583333333333332 },
    ]},
    { id: 'roommppvoge9', name: 'Office', color: '#cdb98d', viewRot: 0, wallOverrides: {"0": {"0": true, "3": false, "4": false, "5": false}, "1": {"0": true, "3": false, "4": false}, "2": {"0": false, "3": true}, "3": {"0": false, "3": false}}, points: [
     { x: 0, y: 22.583333333333332 }, { x: 12, y: 22.583333333333332 }, { x: 12, y: 26.166666666666664 },
     { x: 14, y: 26.166666666666664 }, { x: 14, y: 34.58333333333333 }, { x: 0, y: 34.58333333333333 },
    ]},
    { id: 'roommppwwa08', name: 'Hallway', color: '#beac98', hideName: true, wallOverrides: {"0": {"1": false, "10": false, "11": false, "12": false, "14": false}, "1": {"1": false, "10": true, "11": false, "12": true}, "2": {"1": false, "10": true, "11": false, "12": true}, "3": {"1": false, "10": true, "11": false, "12": true}}, points: [
     { x: 19.25, y: 19.416666666666664 }, { x: 22.5, y: 16.166666666666664 }, { x: 24.166666666666664, y: 17.833333333333332 },
     { x: 27, y: 17.833333333333332 }, { x: 27, y: 20.666666666666664 }, { x: 29.916666666666664, y: 23.583333333333332 },
     { x: 26.666666666666664, y: 26.833333333333332 }, { x: 23.583333333333332, y: 23.75 }, { x: 21, y: 26.166666666666664 },
     { x: 12, y: 26.166666666666664 }, { x: 12, y: 22.583333333333332 }, { x: 15, y: 22.583333333333332 },
     { x: 15, y: 19.333333333333332 }, { x: 18.333333333333332, y: 19.333333333333332 }, { x: 18.333333333333332, y: 22.583333333333332 },
     { x: 20.25, y: 20.416666666666664 },
    ]},
    { id: 'roommppw8v6f', name: 'Wall', color: '#646464', hideName: true, noInteract: true, points: [
     { x: 18.333333333333332, y: 19.416666666666664 }, { x: 19.25, y: 19.416666666666664 }, { x: 20.333333333333332, y: 20.5 },
     { x: 18.333333333333332, y: 22.583333333333332 }, { x: 18.333333333333332, y: 21.166666666666664 },
    ]},
    { id: 'roommppwbopp', name: 'Bathroom 2', color: '#99d6ff', viewRot: 0, wallOverrides: {"0": {"1": false, "2": false, "3": false, "4": false, "5": false, "6": false}, "1": {"1": true, "2": true, "3": true, "4": false, "5": false, "6": false}, "2": {"1": true, "2": true, "3": true, "4": false, "5": false, "6": false}, "3": {"1": true, "2": true, "3": true, "4": false, "5": false, "6": false}}, points: [
     { x: 14, y: 26.166666666666664 }, { x: 16.583333333333332, y: 26.166666666666664 }, { x: 21, y: 26.166666666666664 },
     { x: 21, y: 27.25 }, { x: 23.916666666666664, y: 27.25 }, { x: 23.916666666666664, y: 32.75 },
     { x: 14, y: 32.75 },
    ]},
    { id: 'roommppwldav', name: 'Bathroom 1', color: '#99d6ff', viewRot: 0, wallOverrides: {"0": {"0": false, "7": false, "8": false}, "1": {"0": true, "7": true, "8": true}, "2": {"0": true, "7": true, "8": true}, "3": {"0": true, "7": true, "8": true}}, points: [
     { x: 28.166666666666664, y: 14.083333333333332 }, { x: 36.75, y: 14.083333333333332 }, { x: 36.75, y: 20.75 },
     { x: 35.416666666666664, y: 20.75 }, { x: 35.416666666666664, y: 23.583333333333332 }, { x: 29.916666666666664, y: 23.583333333333332 },
     { x: 29.916666666666664, y: 20.666666666666664 }, { x: 27, y: 20.666666666666664 }, { x: 27, y: 17.833333333333332 },
     { x: 28.166666666666664, y: 17.833333333333332 },
    ]},
    { id: 'roommppwsbzu', name: 'Wall', color: '#646464', hideName: true, noInteract: true, points: [
     { x: 27, y: 20.666666666666664 }, { x: 29.916666666666664, y: 20.666666666666664 }, { x: 29.916666666666664, y: 23.583333333333332 },
     { x: 28.5, y: 22.166666666666664 },
    ]},
    { id: 'roommppwtqw1', name: 'Storage', color: '#beac98', viewRot: 0, wallOverrides: {"0": {"1": false, "2": false, "3": false, "4": false, "5": false}, "1": {"1": true, "2": true, "3": true, "4": true, "5": false}, "2": {"1": true, "2": true, "3": true, "4": true, "5": false}, "3": {"1": true, "2": true, "3": true, "4": true, "5": false}}, points: [
     { x: 21, y: 26.166666666666664 }, { x: 23.5, y: 23.666666666666664 }, { x: 26.666666666666664, y: 26.833333333333332 },
     { x: 25.083333333333332, y: 28.416666666666664 }, { x: 23.916666666666664, y: 27.25 }, { x: 21, y: 27.25 },
    ]},
    { id: 'roommpyt30fx', name: 'Play Area', color: '#beac98', points: [
     { x: 15, y: 6.666666666666666 }, { x: 24.166666666666664, y: 6.666666666666666 }, { x: 24.166666666666664, y: 12.75 },
     { x: 24.166666666666664, y: 14.5 }, { x: 19.25, y: 19.416666666666664 }, { x: 15, y: 19.416666666666664 },
    ]},
    { id: 'roommq1x5q28', name: 'Wall', color: '#646464', points: [
     { x: 22.5, y: 16.166666666666664 }, { x: 24.166666666666664, y: 14.5 }, { x: 24.166666666666664, y: 17.833333333333332 },
     { x: 24.166666666666664, y: 17.833333333333332 },
    ]},
  ],
};

// Furniture keyed by room id. Seeded from home.json; user additions are persisted
// to localStorage. (x,y) is room-local, relative to the room's polygon-bbox origin.
let HOME_FURNITURE = {
  roommppoommb: [
    { id: 'f-mpw6fek4', label: 'Island', x: 4.666666666666666, y: 1.6666666666666665, w: 5.75, d: 3.1666666666666665, h: 0.3333333333333333, z: 3, color: '#e0cba2', storage: true, zOrder: 9, zOrders: {"3": 29} },
    { id: 'f-mpw6hda70', label: 'Island', x: 4.916666666666666, y: 1.9166666666666665, w: 5.25, d: 2.6666666666666665, h: 3, z: 0, color: '#fefaf0', storage: false, zOrder: 8, zOrders: {"3": 28} },
    { id: 'f-mpw6n5oj', label: 'Fridge', x: 12.416666666666666, y: 7.333333333333333, w: 2.583333333333333, d: 2.1666666666666665, h: 5.666666666666666, color: '#c0c0c0', storage: true, zOrder: 14, zOrders: {"3": 22} },
    { id: 'f-mpw6oui9', label: 'New piece', x: 0.08333333333333333, y: 7.333333333333333, w: 7.25, d: 2.1666666666666665, h: 0.16666666666666666, z: 3, color: '#e0cba2', zOrder: 11, zOrders: {"3": 11} },
    { id: 'f-mpw6qha4', label: 'Pantry', x: 10.916666666666666, y: 7.333333333333333, w: 1.5, d: 2.166666666666667, h: 6.416666666666666, color: '#fefaf0', storage: true, zOrder: 13, zOrders: {"3": 21} },
    { id: 'f-mpw6te590', label: 'New piece', x: 0.9166666666666666, y: 7.333333333333333, w: 2, d: 2.166666666666667, h: 3, color: '#c0c0c0', zOrder: 1, zOrders: {"3": 3} },
    { id: 'f-mpw6ujbf0', label: 'New piece', x: 2.75, y: 7.75, w: 2.6666666666666665, d: 1.5, h: 0.08333333333333333, z: 3, color: '#c0c0c0', zOrder: 12, zOrders: {"3": 25} },
    { id: 'f-mpw6wwmb0', label: 'New piece', x: 7.333333333333333, y: 7.25, w: 2.75, d: 2.25, h: 3.1666666666666665, color: '#444444', zOrder: 5, zOrders: {"3": 12} },
    { id: 'f-mpw71z5q0', label: 'New piece', x: 2.9166666666666665, y: 7.333333333333333, w: 1.75, d: 2.166666666666667, h: 2.4166666666666665, color: '#fefaf0', zOrder: 3, zOrders: {"3": 4} },
    { id: 'f-mpw73fr70', label: 'New piece', x: 10.083333333333332, y: 7.333333333333333, w: 0.8333333333333339, d: 2.1666666666666665, h: 3, color: '#fefaf0', zOrder: 10, zOrders: {"3": 14} },
    { id: 'f-mpw75o9r', label: 'New piece', shape: 'circle', x: 5.75, y: 4.5, w: 1.3333333333333333, d: 1.3333333333333333, h: 3.5, color: '#e0d2b6', zOrder: 6, zOrders: {"3": 10} },
    { id: 'f-mpw772ex0', label: 'New piece', shape: 'circle', x: 7.916666666666666, y: 4.5, w: 1.3333333333333333, d: 1.3333333333333333, h: 3.5, color: '#e0d2b6', zOrder: 7, zOrders: {"3": 13} },
    { id: 'f-mpx9421s', label: 'New piece', x: 4.166666666666666, y: 1.9166666666666665, w: 0.75, d: 1.1666666666666665, h: 1.5, color: '#ebebeb', zOrder: 2, zOrders: {"3": 8} },
    { id: 'f-mpxfyi19', label: 'New piece', x: 0.08333333333333333, y: 9.5, w: 14.83333333333333, d: 0.08333333333333333, h: 6.5, color: '#e0d2b6', zOrders: {"3": 1} },
    { id: 'f-mq1xv4do0', label: 'New piece', x: 0, y: 0, w: 0.08333333333333333, d: 9.583333333333332, h: 7, color: '#e0d2b6', zOrders: {"3": 0} },
    { id: 'f-mq1y61ic', label: 'New piece', x: 0.08333333333333333, y: 2.333333333333333, w: 0.08333333333333333, d: 3.6666666666666665, h: 5.25, z: 1.3333333333333333, color: '#ffffff', zOrders: {"3": 7} },
    { id: 'f-mq2o1us6', label: 'New piece', x: 0.08333333333333333, y: 8.583333333333332, w: 1, d: 1, h: 2.6666666666666665, z: 3.75, color: '#fefaf0', zOrders: {"3": 23} },
    { id: 'f-mq2o4toe0', label: 'New piece', x: 1.0833333333333333, y: 8.583333333333332, w: 1, d: 1, h: 2.6666666666666665, z: 3.75, color: '#fefaf0', zOrders: {"3": 24} },
    { id: 'f-mq2o630m0', label: 'New piece', x: 10.083333333333332, y: 8.5, w: 0.8333333333333339, d: 1, h: 2.583333333333333, z: 3.833333333333333, color: '#fefaf0', zOrders: {"3": 20} },
    { id: 'f-mq2o6ebh0', label: 'New piece', x: 8.666666666666666, y: 8.5, w: 1.416666666666666, d: 1, h: 1.25, z: 5.166666666666666, color: '#fefaf0', zOrders: {"3": 19} },
    { id: 'f-mq2o8cjp0', label: 'New piece', x: 7.25, y: 8.5, w: 1.416666666666666, d: 1, h: 1.25, z: 5.166666666666666, color: '#fefaf0', zOrders: {"3": 18} },
    { id: 'f-mq2obt910', label: 'New piece', x: 6.5, y: 7.333333333333333, w: 0.8333333333333339, d: 2.1666666666666665, h: 3, color: '#fefaf0', zOrder: 10, zOrders: {"3": 9} },
    { id: 'f-mq2od2pc0', label: 'New piece', x: 10.083333333333332, y: 7.333333333333333, w: 0.8333333333333339, d: 2.166666666666667, h: 0.16666666666666666, z: 3, color: '#e0cba2', zOrder: 11, zOrders: {"3": 15} },
    { id: 'f-mq2oe4h90', label: 'New piece', x: 0.08333333333333333, y: 7.333333333333333, w: 0.8333333333333339, d: 2.1666666666666665, h: 3, color: '#fefaf0', zOrder: 10, zOrders: {"3": 2} },
    { id: 'f-mq2ofe9f0', label: 'New piece', x: 4.666666666666666, y: 7.333333333333333, w: 1.8333333333333333, d: 2.1666666666666665, h: 2.4166666666666665, color: '#fefaf0', zOrder: 3, zOrders: {"3": 5} },
    { id: 'f-mq2oftqk0', label: 'New piece', x: 2.9166666666666665, y: 7.333333333333333, w: 3.583333333333333, d: 2.166666666666667, h: 0.5833333333333333, z: 2.4166666666666665, color: '#fefaf0', zOrder: 3, zOrders: {"3": 6} },
    { id: 'f-mq2oi8vm0', label: 'New piece', x: 4, y: 9.083333333333332, w: 0.16666666666666666, d: 0.08333333333333393, h: 1.1666666666666665, z: 3, color: '#c0c0c0', zOrder: 12, zOrders: {"3": 26} },
    { id: 'f-mq2ok7c00', label: 'New piece', x: 4, y: 8.75, w: 0.16666666666666666, d: 0.41666666666666663, h: 0.16666666666666666, z: 4, color: '#c0c0c0', zOrder: 12, zOrders: {"3": 27} },
    { id: 'f-mq2onnju0', label: 'New piece', x: 6.416666666666666, y: 8.5, w: 0.8333333333333339, d: 1, h: 2.583333333333333, z: 3.833333333333333, color: '#fefaf0', zOrders: {"3": 16} },
    { id: 'f-mq2oo4vp0', label: 'New piece', x: 7.333333333333333, y: 8.416666666666666, w: 2.75, d: 1.083333333333334, h: 1.25, z: 4.166666666666666, color: '#444444', zOrder: 5, zOrders: {"3": 17} },
  ],
  roommppoe0wb: [
    { id: 'f-mpw55suc', label: 'Carpet', x: 2.6666666666666665, y: 0.8333333333333333, w: 5.416666666666666, d: 7.749999999999999, h: 0.08333333333333333, color: '#e0d2b6', zOrder: 1, zOrders: {"0": 5} },
    { id: 'f-mpw56lqc', label: 'New piece', x: 0.41666666666666663, y: 0.3333333333333333, w: 3.083333333333333, d: 2.1666666666666665, h: 0.5833333333333333, color: '#919191', zOrder: 2, zOrders: {"0": 6} },
    { id: 'f-mpw5e52b0', label: 'New piece', x: 0.41666666666666663, y: 6.833333333333333, w: 6.583333333333333, d: 2.333333333333333, h: 1.25, color: '#919191', zOrder: 8, zOrders: {"0": 28} },
    { id: 'f-mpw5kyxx0', label: 'New piece', x: 0.41666666666666663, y: 8.833333333333332, w: 4.916666666666666, d: 0.3333333333333333, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 15, zOrders: {"0": 32} },
    { id: 'f-mpw5qbcr0', label: 'New piece', x: 0.41666666666666663, y: 0.3333333333333333, w: 0.25, d: 8.5, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 0, zOrders: {"0": 7} },
    { id: 'f-mpw5st700', label: 'New piece', x: 0.41666666666666663, y: 2.5, w: 3.083333333333333, d: 2.1666666666666665, h: 0.5833333333333333, color: '#919191', zOrder: 4, zOrders: {"0": 12} },
    { id: 'f-mpw5stit0', label: 'New piece', x: 0.41666666666666663, y: 4.666666666666666, w: 3.083333333333333, d: 2.1666666666666665, h: 0.5833333333333333, color: '#919191', zOrder: 6, zOrders: {"0": 13} },
    { id: 'f-mpw5tqrz0', label: 'New piece', x: 0.6666666666666666, y: 0.3333333333333333, w: 0.6666666666666666, d: 2.1666666666666665, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 9, zOrders: {"0": 23} },
    { id: 'f-mpw5v8am0', label: 'New piece', x: 0.6666666666666666, y: 2.5, w: 0.6666666666666666, d: 2.1666666666666665, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 10, zOrders: {"0": 25} },
    { id: 'f-mpw5v8zk0', label: 'New piece', x: 0.6666666666666666, y: 4.666666666666666, w: 0.6666666666666666, d: 2.1666666666666665, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 11, zOrders: {"0": 27} },
    { id: 'f-mpw5vu8g0', label: 'New piece', x: 0.6666666666666666, y: 6.833333333333333, w: 0.6666666666666666, d: 1.3333333333333348, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 12, zOrders: {"0": 29} },
    { id: 'f-mpw5yc0s0', label: 'New piece', x: 0.6666666666666666, y: 8.166666666666666, w: 2.1666666666666665, d: 0.6666666666666666, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 13, zOrders: {"0": 30} },
    { id: 'f-mpw5z7ze0', label: 'New piece', x: 2.75, y: 8.166666666666666, w: 2.1666666666666665, d: 0.6666666666666666, h: 1.3333333333333333, z: 1.25, color: '#919191', zOrder: 14, zOrders: {"0": 31} },
    { id: 'f-mpw64xzc0', label: 'New piece', x: 0.41666666666666663, y: 2.5, w: 3.083333333333333, d: 2.1666666666666665, h: 0.6666666666666666, z: 0.5833333333333333, color: '#919191', zOrder: 3, zOrders: {"0": 24} },
    { id: 'f-mpw67l1r0', label: 'New piece', x: 0.41666666666666663, y: 0.3333333333333333, w: 3.083333333333333, d: 2.1666666666666665, h: 0.6666666666666666, z: 0.5833333333333333, color: '#919191', zOrder: 5, zOrders: {"0": 9} },
    { id: 'f-mpw681890', label: 'New piece', x: 0.41666666666666663, y: 4.666666666666666, w: 3.083333333333333, d: 2.1666666666666665, h: 0.6666666666666666, z: 0.5833333333333333, color: '#919191', zOrder: 7, zOrders: {"0": 26} },
    { id: 'f-mpxg4080', label: 'New piece', x: 11.5, y: 0.5833333333333333, w: 3.083333333333333, d: 5.5, h: 0.25, z: 2.333333333333333, color: '#b3a490', zOrders: {"0": 21} },
    { id: 'f-mpxg6qo6', label: 'New piece', x: 14.916666666666666, y: 1.5, w: 0.08333333333333333, d: 3.5, h: 2.5, z: 4, color: '#343434', zOrders: {"0": 22} },
    { id: 'f-mpysec9u', label: 'New piece', x: 11.833333333333332, y: 5.583333333333333, w: 2.4166666666666665, d: 0.25, h: 0.08333333333333333, color: '#ffffff', zOrders: {"0": 19} },
    { id: 'f-mpyseuwk0', label: 'New piece', x: 11.833333333333332, y: 0.9166666666666666, w: 2.4166666666666665, d: 0.25, h: 0.08333333333333333, color: '#ffffff', zOrders: {"0": 16} },
    { id: 'f-mpysf7jg', label: 'New piece', x: 11.75, y: 5.583333333333333, w: 0.08333333333333333, d: 0.25, h: 2.333333333333333, z: 0, color: '#ffffff', zOrders: {"0": 18} },
    { id: 'f-mpysgudd0', label: 'New piece', x: 14.25, y: 5.583333333333333, w: 0.08333333333333333, d: 0.25, h: 2.333333333333333, z: 0, color: '#ffffff', zOrders: {"0": 20} },
    { id: 'f-mpysjkyx0', label: 'New piece', x: 14.25, y: 0.9166666666666666, w: 0.08333333333333333, d: 0.25, h: 2.333333333333333, z: 0, color: '#ffffff', zOrders: {"0": 17} },
    { id: 'f-mpysjvxy0', label: 'New piece', x: 11.75, y: 0.9166666666666666, w: 0.08333333333333333, d: 0.25, h: 2.333333333333333, z: 0, color: '#ffffff', zOrders: {"0": 15} },
    { id: 'f-mpysoco1', label: 'New piece', shape: 'circle', x: 4.75, y: 0.3333333333333333, w: 0.75, d: 0.75, h: 1.3333333333333333, color: '#b65840', zOrders: {"0": 10} },
    { id: 'f-mpysox5l', label: 'New piece', shape: 'circle', x: 4.5, y: 0.08333333333333333, w: 1.25, d: 1.25, h: 0.08333333333333333, z: 1.3333333333333333, color: '#009193', zOrders: {"0": 11} },
    { id: 'f-mpysxbp3', label: 'New piece', x: 0.08333333333333333, y: 0, w: 0.6666666666666666, d: 0.6666666666666666, h: 6.083333333333333, color: '#c8a070', zOrders: {"0": 4} },
    { id: 'f-mq1xvsjh', label: 'New piece', x: 0, y: 0, w: 15, d: 0.08333333333333333, h: 7, color: '#e0d2b6', zOrders: {"0": 0} },
    { id: 'f-mq1xwgd30', label: 'New piece', x: 0, y: 0.08333333333333333, w: 0.08333333333333333, d: 12.916666666666666, h: 7, color: '#e0d2b6', zOrders: {"0": 1} },
    { id: 'f-mq1y8f8b', label: 'New piece', x: 0.08333333333333333, y: 3.333333333333333, w: 0.16666666666666666, d: 3.333333333333333, h: 5.333333333333333, z: 1.3333333333333333, color: '#ffffff', zOrders: {"0": 2} },
    { id: 'f-mq1y8xu40', label: 'New piece', x: 0.08333333333333333, y: 6.75, w: 0.16666666666666666, d: 3.333333333333333, h: 5.333333333333333, z: 1.3333333333333333, color: '#ffffff', zOrders: {"0": 3} },
    { id: 'f-mq1y99t60', label: 'New piece', x: 3.5, y: 0.08333333333333333, w: 3.333333333333333, d: 0.16666666666666666, h: 5.25, z: 1.3333333333333333, color: '#ffffff', zOrders: {"0": 8} },
    { id: 'f-mq1ya6ay0', label: 'New piece', x: 6.916666666666666, y: 0.08333333333333333, w: 3.333333333333333, d: 0.16666666666666666, h: 5.25, z: 1.3333333333333333, color: '#ffffff', zOrders: {"0": 14} },
  ],
  roommppvoge9: [
    { id: 'f-mpusy685', label: 'Shelf', x: 0.08333333333333333, y: 0, w: 7.583333333333333, d: 1, h: 4.833333333333333, color: '#849676', storage: true, zOrder: 2, zOrders: {"0": 5, "1": 0, "2": 28, "3": 28} },
    { id: 'f-mpuszg0c', label: 'New piece', x: 12.166666666666666, y: 3.833333333333333, w: 1.666666666666666, d: 8, h: 4, color: '#e0e0de', storage: true, zOrder: 19, zOrders: {"0": 26, "1": 6, "2": 0, "3": 22} },
    { id: 'f-mput05du', label: 'New piece', shape: 'circle', x: 0.25, y: 6.333333333333333, w: 0.5, d: 0.5, h: 0.75, z: 2.1666666666666665, color: '#77bb41', zOrder: 23, zOrders: {"0": 27, "1": 22, "2": 26, "3": 25} },
    { id: 'f-mpvze2pb0', label: 'Desk', x: 0.16666666666666666, y: 6.166666666666666, w: 5.833333333333333, d: 2.4166666666666665, h: 0.16666666666666666, z: 2, color: '#d6d6d6', storage: false, zOrder: 21, zOrders: {"0": 18, "1": 15, "2": 25, "3": 24} },
    { id: 'f-mpvzfawv0', label: 'New piece', x: 5.25, y: 7.25, w: 0.25, d: 0.3333333333333333, h: 2, z: 0, color: '#929292', groupId: 'g-mpw1i83m', zOrder: 16, zOrders: {"0": 3, "1": 14, "2": 7, "3": 20} },
    { id: 'f-mpvzfawv1', label: 'New piece', x: 5.25, y: 6.666666666666666, w: 0.25, d: 1.5000000000000009, h: 0.08333333333333333, color: '#929292', groupId: 'g-mpw1i83m', zOrder: 11, zOrders: {"0": 4, "1": 13, "2": 6, "3": 15} },
    { id: 'f-mpvzg2lt', label: 'New piece', x: 5.083333333333333, y: 10.333333333333332, w: 2, d: 1.6666666666666665, h: 1.0833333333333333, color: '#e0d2b6', zOrder: 13, zOrders: {"0": 22, "1": 16, "2": 1, "3": 17} },
    { id: 'f-mpw0beov0', label: 'Desk', x: 0.16666666666666666, y: 8.583333333333332, w: 1.8333333333333333, d: 3.4166666666666665, h: 0.16666666666666666, z: 2, color: '#d6d6d6', storage: false, zOrder: 22, zOrders: {"0": 20, "1": 27, "2": 10, "3": 4} },
    { id: 'f-mpw1iaya0', label: 'New piece', x: 0.8333333333333333, y: 11.583333333333332, w: 0.3333333333333333, d: 0.25, h: 2, z: 0, color: '#929292', groupId: 'g-mpw1iaya', zOrder: 18, zOrders: {"0": 1, "1": 26, "2": 8, "3": 2} },
    { id: 'f-mpw1iaya1', label: 'New piece', x: 0.25, y: 11.583333333333332, w: 1.5000000000000009, d: 0.25, h: 0.08333333333333333, color: '#929292', groupId: 'g-mpw1iaya', zOrder: 1, zOrders: {"0": 2, "1": 25, "2": 9, "3": 3} },
    { id: 'f-mpw1ikzw0', label: 'New piece', x: 1, y: 6.833333333333333, w: 0.3333333333333333, d: 0.25, h: 2, z: 0, color: '#929292', groupId: 'g-mpw1ikzw', zOrder: 17, zOrders: {"0": 16, "1": 21, "2": 24, "3": 21} },
    { id: 'f-mpw1ikzw1', label: 'New piece', x: 0.41666666666666663, y: 6.833333333333333, w: 1.5000000000000009, d: 0.25, h: 0.08333333333333333, color: '#929292', groupId: 'g-mpw1ikzw', zOrder: 12, zOrders: {"0": 15, "1": 20, "2": 23, "3": 16} },
    { id: 'f-mpw1lb160', label: 'New piece', x: 5.083333333333333, y: 10.333333333333332, w: 2, d: 1.6666666666666665, h: 0.5833333333333333, z: 1.0833333333333333, color: '#e0d2b6', zOrder: 14, zOrders: {"0": 23, "1": 17, "2": 2, "3": 18} },
    { id: 'f-mpw1leir0', label: 'New piece', x: 5.083333333333333, y: 10.333333333333332, w: 2, d: 1.6666666666666665, h: 0.6666666666666666, z: 1.6666666666666665, color: '#e0d2b6', zOrder: 15, zOrders: {"0": 24, "1": 18, "2": 3, "3": 19} },
    { id: 'f-mpw1lqs30', label: 'New piece', x: 5.083333333333333, y: 10.333333333333332, w: 2, d: 1.6666666666666665, h: 1.25, z: 2.333333333333333, color: '#e0d2b6', storage: true, zOrder: 20, zOrders: {"0": 25, "1": 19, "2": 4, "3": 23} },
    { id: 'f-mpw1oq0s', label: 'New piece', x: 0.08333333333333333, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', storage: false, zOrder: 3, zOrders: {"0": 6, "1": 12, "2": 15, "3": 7} },
    { id: 'f-mpw1qelb0', label: 'New piece', x: 1, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', storage: false, zOrder: 4, zOrders: {"0": 7, "1": 11, "2": 16, "3": 8} },
    { id: 'f-mpw1qkkh0', label: 'New piece', x: 1.9166666666666665, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', storage: false, zOrder: 5, zOrders: {"0": 8, "1": 10, "2": 17, "3": 9} },
    { id: 'f-mpw1qqi20', label: 'New piece', x: 2.9166666666666665, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', storage: false, zOrder: 6, zOrders: {"0": 9, "1": 9, "2": 18, "3": 10} },
    { id: 'f-mpw1qsc10', label: 'New piece', x: 3.9166666666666665, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', storage: false, zOrder: 7, zOrders: {"0": 11, "1": 8, "2": 19, "3": 11} },
    { id: 'f-mpw1qttz0', label: 'New piece', x: 5, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', storage: false, zOrder: 8, zOrders: {"0": 12, "1": 7, "2": 20, "3": 12} },
    { id: 'f-mpw1qvhl0', label: 'New piece', x: 6, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', zOrder: 9, zOrders: {"0": 13, "1": 5, "2": 21, "3": 13} },
    { id: 'f-mpw1qx1t0', label: 'New piece', x: 7, y: 1, w: 0.6666666666666666, d: 0.25, h: 4.833333333333333, color: '#5a5048', zOrder: 10, zOrders: {"0": 17, "1": 4, "2": 22, "3": 14} },
    { id: 'f-mpx9bve7', label: 'New piece', x: 0.08333333333333333, y: 2.75, w: 0.08333333333333333, d: 3.333333333333333, h: 5.25, z: 1.3333333333333333, color: '#ffffff', zOrder: 0, zOrders: {"0": 10, "1": 3, "2": 14, "3": 6} },
    { id: 'f-mpxeihgb', label: 'New piece', x: 10.166666666666666, y: 0.16666666666666666, w: 0.41666666666666663, d: 0.08333333333333333, h: 0.16666666666666666, z: 3, color: '#d6d6d6', zOrders: {"0": 28, "1": 2, "2": 12, "3": 26} },
    { id: 'f-mpxej1w0', label: 'New piece', x: 10, y: 0.08333333333333333, w: 1.9166666666666665, d: 0.08333333333333333, h: 6.083333333333333, color: '#fbeacb', zOrders: {"0": 19, "1": 1, "2": 11, "3": 27} },
    { id: 'f-mq1xtj62', label: 'New piece', x: 0, y: 0, w: 0.08333333333333333, d: 12, h: 7, color: '#e0d2b6', zOrders: {"0": 0, "1": 28, "2": 27, "3": 0} },
    { id: 'f-mq1y555m0', label: 'New piece', x: 0.08333333333333333, y: 6.166666666666666, w: 0.08333333333333333, d: 3.333333333333333, h: 5.25, z: 1.3333333333333333, color: '#ffffff', zOrder: 0, zOrders: {"0": 14, "1": 24, "2": 13, "3": 1} },
    { id: 'f-mq2lojc7', label: 'New piece', shape: 'circle', x: 2.75, y: 9.333333333333332, w: 1.25, d: 1.25, h: 1.75, color: '#5a5048', zOrders: {"0": 21, "1": 23, "2": 5, "3": 5} },
  ],
  roommppw1wos: [
    { id: 'f-mpw6kmaq', label: 'New piece', x: 0.3333333333333333, y: 0.3333333333333333, w: 2.6666666666666665, d: 2.5, h: 3, color: '#ffffff', zOrders: {"0": 2} },
    { id: 'f-mpw6lvvk0', label: 'New piece', x: 0.3333333333333333, y: 0.3333333333333333, w: 2.6666666666666665, d: 2.5, h: 3, z: 3, color: '#ffffff', zOrders: {"0": 3} },
    { id: 'f-mq1xqpn8', label: 'New piece', x: 0, y: 0, w: 3.333333333333333, d: 0.08333333333333333, h: 6, color: '#e0d2b6', zOrders: {"0": 0} },
    { id: 'f-mq1xrbkt0', label: 'New piece', x: 0, y: 0.08333333333333333, w: 0.08333333333333333, d: 3.083333333333333, h: 6, color: '#e0d2b6', zOrders: {"0": 1} },
    { id: 'f-mq2lulny0', label: 'New piece', x: 3.25, y: 0.08333333333333333, w: 0.08333333333333333, d: 3.083333333333333, h: 6, color: '#e0d2b6', zOrders: {"0": 4} },
  ],
  roommppwbopp: [
    { id: 'f-mpx9grkd', label: 'New piece', x: 0.08333333333333333, y: 4.416666666666666, w: 4, d: 2.166666666666667, h: 2.5, z: 0, color: '#fbeacb', zOrder: 0, zOrders: {"0": 6} },
    { id: 'f-mpx9i8x2', label: 'Medicine Cabinet', x: 0.08333333333333333, y: 5, w: 0.08333333333333333, d: 1.166666666666667, h: 2.333333333333333, z: 3, color: '#d6d6d6', storage: true, zOrder: 1, zOrders: {"0": 13} },
    { id: 'f-mpxdjvjk', label: 'New piece', x: 7.166666666666666, y: 1.1666666666666665, w: 2.75, d: 5.416666666666666, h: 2, color: '#ffffff', zOrders: {"0": 11} },
    { id: 'f-mpxdlmet', label: 'New piece', shape: 'circle', x: 7.5, y: 1.4166666666666665, w: 2.1666666666666665, d: 4.916666666666666, h: 0.08333333333333333, z: 2, color: '#ebebeb', zOrders: {"0": 12} },
    { id: 'f-mpxdoe2n', label: 'New piece', shape: 'circle', x: 1.5, y: 4.833333333333333, w: 1.75, d: 1.4166666666666665, h: 0.08333333333333333, z: 2.5, color: '#ffffff', zOrders: {"0": 7} },
    { id: 'f-mpxe7wjp', label: 'New piece', x: 4.083333333333333, y: 6, w: 3.583333333333333, d: 0.5833333333333333, h: 0.08333333333333333, z: 2.4166666666666665, color: '#fbeacb', zOrders: {"0": 10} },
    { id: 'f-mpxeahdy', label: 'New piece', x: 4.916666666666666, y: 5.916666666666666, w: 1.5, d: 0.6666666666666661, h: 1.25, z: 1.25, color: '#ffffff', zOrders: {"0": 9} },
    { id: 'f-mpxebjl2', label: 'New piece', shape: 'circle', x: 5, y: 4.5, w: 1.25, d: 2, h: 1.5, color: '#ffffff', zOrders: {"0": 8} },
    { id: 'f-mpxee8qc', label: 'New piece', shape: 'rect', x: 0.08333333333333333, y: 0, w: 0.08333333333333333, d: 1.9166666666666665, h: 6.083333333333333, color: '#ece0c8', zOrders: {"0": 4} },
    { id: 'f-mpxeepcp', label: 'New piece', x: 0.16666666666666666, y: 1.5, w: 0.08333333333333333, d: 0.41666666666666663, h: 0.16666666666666666, z: 3, color: '#d6d6d6', zOrders: {"0": 5} },
    { id: 'f-mpxg0kkc', label: 'New piece', x: 0, y: 0, w: 0.08333333333333333, d: 6.583333333333333, h: 6, color: '#e0d2b6', zOrders: {"0": 3} },
    { id: 'f-mq2n1h5j0', label: 'New piece', x: 6.916666666666666, y: 0, w: 0.08333333333333333, d: 1.0833333333333333, h: 6, color: '#e0d2b6', zOrders: {"0": 1} },
    { id: 'f-mq2n1vl50', label: 'New piece', x: 2.1666666666666665, y: 0, w: 4.75, d: 0.08333333333333333, h: 6, color: '#e0d2b6', zOrders: {"0": 0} },
    { id: 'f-mq2n2b350', label: 'New piece', x: 6.916666666666666, y: 1.0833333333333333, w: 3, d: 0.08333333333333333, h: 6, color: '#e0d2b6', zOrders: {"0": 2} },
  ],
  roommppwwa08: [
    { id: 'f-mqhhp89o0zy1', label: 'New piece', x: 2.9166666666666665, y: 3.1666666666666665, w: 0.08333333333333333, d: 3.333333333333333, h: 6.5, color: '#e0d2b6', zOrders: {"0": 0} },
    { id: 'f-mqhhpo500wlz', label: 'New piece', x: 3, y: 3.1666666666666665, w: 3.25, d: 0.08333333333333333, h: 6.5, color: '#e0d2b6', zOrders: {"0": 1} },
  ],
  roommppocsb8: [
    { id: 'f-mpysyonl', label: 'New piece', x: 0.25, y: 0.25, w: 2, d: 3, h: 1.3333333333333333, color: '#aaaaaa', zOrders: {"0": 1} },
    { id: 'f-mpysz0m80', label: 'New piece', x: 0.25, y: 3.333333333333333, w: 2, d: 3, h: 1.3333333333333333, color: '#aaaaaa', zOrders: {"0": 15} },
    { id: 'f-mpyt0kyc0', label: 'New piece', x: 0.25, y: 3.333333333333333, w: 2, d: 3, h: 1.3333333333333333, z: 1.3333333333333333, color: '#aaaaaa', zOrders: {"0": 16} },
    { id: 'f-mpyt0qe80', label: 'New piece', x: 0.25, y: 0.25, w: 2, d: 3, h: 1.3333333333333333, z: 1.3333333333333333, color: '#aaaaaa', zOrders: {"0": 7} },
    { id: 'f-mq2m9pip0', label: 'Patio Storage', x: 0.25, y: 0.25, w: 2, d: 6.083333333333333, h: 0.08333333333333333, z: 2.6666666666666665, color: '#aaaaaa', zOrders: {"0": 25} },
    { id: 'f-mq2p1fj0', label: 'New piece', x: 0, y: 0, w: 9.166666666666666, d: 0.25, h: 2, color: '#e0d2b6', zOrders: {"0": 0} },
    { id: 'f-mq2p1t8s', label: 'New piece', x: 9.083333333333332, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 24} },
    { id: 'f-mq2p310z0', label: 'New piece', x: 0, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 2} },
    { id: 'f-mq2p3fue0', label: 'New piece', x: 0.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 3} },
    { id: 'f-mq2p3shs0', label: 'New piece', x: 1, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 4} },
    { id: 'f-mq2p3unj0', label: 'New piece', x: 1.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 5} },
    { id: 'f-mq2p3xqg0', label: 'New piece', x: 2, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 6} },
    { id: 'f-mq2p3zlf0', label: 'New piece', x: 2.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 8} },
    { id: 'f-mq2p41g10', label: 'New piece', x: 3, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 9} },
    { id: 'f-mq2p431q0', label: 'New piece', x: 3.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 10} },
    { id: 'f-mq2p440u0', label: 'New piece', x: 4, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 11} },
    { id: 'f-mq2p44xv0', label: 'New piece', x: 4.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 12} },
    { id: 'f-mq2p45va0', label: 'New piece', x: 5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 13} },
    { id: 'f-mq2p46qh0', label: 'New piece', x: 5.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 17} },
    { id: 'f-mq2p47mu0', label: 'New piece', x: 6, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 18} },
    { id: 'f-mq2p48if0', label: 'New piece', x: 6.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 19} },
    { id: 'f-mq2p49d30', label: 'New piece', x: 7, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 20} },
    { id: 'f-mq2p4aal0', label: 'New piece', x: 7.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 21} },
    { id: 'f-mq2p4b8d0', label: 'New piece', x: 8, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 22} },
    { id: 'f-mq2p4c5t0', label: 'New piece', x: 8.5, y: 0.08333333333333333, w: 0.08333333333333333, d: 0.08333333333333333, h: 2.25, z: 2, color: '#5a5048', zOrders: {"0": 23} },
    { id: 'f-mq2p4d8w0', label: 'New piece', x: 0, y: 0.08333333333333333, w: 9.166666666666668, d: 0.08333333333333333, h: 0.08333333333333333, z: 4.25, color: '#5a5048', zOrders: {"0": 14} },
  ],
  roommpyt30fx: [
    { id: 'f-mq1vvnfe', label: 'New piece', x: 6.666666666666666, y: 1.75, w: 2.4166666666666665, d: 2.4166666666666665, h: 0.08333333333333333, color: '#849676' },
    { id: 'f-mq1vw7ku0', label: 'New piece', x: 6.666666666666666, y: 4.166666666666666, w: 2.4166666666666665, d: 2.4166666666666665, h: 0.08333333333333333, color: '#b65840' },
    { id: 'f-mq1vwasu0', label: 'New piece', x: 4.25, y: 4.166666666666666, w: 2.4166666666666665, d: 2.4166666666666665, h: 0.08333333333333333, color: '#c8a070' },
    { id: 'f-mq1vweco0', label: 'New piece', x: 4.25, y: 1.75, w: 2.4166666666666665, d: 2.4166666666666665, h: 0.08333333333333333, color: '#666666' },
    { id: 'f-mq1wqdtc', label: 'New piece', shape: 'circle', x: 7.583333333333333, y: 0.16666666666666666, w: 1.5, d: 1.5, h: 1.5, color: '#e0d2b6' },
    { id: 'f-mq2lt1t3', label: 'New piece', x: 6.75, y: 0, w: 2.4166666666666665, d: 0.08333333333333333, h: 6, color: '#e0d2b6' },
    { id: 'f-mq2lx1i1', label: 'New piece', x: 3.4166666666666665, y: 0, w: 3.333333333333333, d: 0.08333333333333333, h: 5, color: '#ffffff' },
    { id: 'f-mq2lya2q0', label: 'New piece', x: 0.6666666666666666, y: 0.08333333333333333, w: 3.333333333333333, d: 0.08333333333333333, h: 5, color: '#ffffff' },
    { id: 'f-mq2lygeb0', label: 'New piece', x: 0, y: 0, w: 0.6666666666666666, d: 0.08333333333333333, h: 6, color: '#e0d2b6' },
  ],
  bedroom1: [
    { id: 'f-mq1xztak', label: 'New piece', x: 0, y: 0, w: 13.083333333333332, d: 0.08333333333333333, h: 7, color: '#e0d2b6', zOrders: {"0": 0} },
    { id: 'f-mq2lquu7', label: 'New piece', x: 2.083333333333333, y: 0.08333333333333333, w: 3.333333333333333, d: 0.08333333333333333, h: 5.25, z: 1.3333333333333333, color: '#ffffff', zOrders: {"0": 1} },
    { id: 'f-mq2lrz1q0', label: 'New piece', x: 5.5, y: 0.08333333333333333, w: 3.333333333333333, d: 0.08333333333333333, h: 5.25, z: 1.3333333333333333, color: '#ffffff', zOrders: {"0": 2} },
    { id: 'f-mq2m0ezg', label: 'Bed Storage', x: 6.166666666666666, y: 4.083333333333333, w: 6.666666666666666, d: 5, h: 0.8333333333333333, z: 0, color: '#ffffff', zOrders: {"0": 3} },
    { id: 'f-mq2m1g2i0', label: 'Bed Storage', x: 6.166666666666666, y: 4.083333333333333, w: 6.666666666666666, d: 5, h: 1, z: 0.8333333333333333, color: '#c8a070', zOrders: {"0": 4} },
    { id: 'f-mq2m2711', label: 'New piece', x: 12.833333333333332, y: 4, w: 0.16666666666666666, d: 5.083333333333332, h: 2.583333333333333, color: '#ffffff', zOrders: {"0": 6} },
    { id: 'f-mq2m2ymq', label: 'New piece', x: 11.416666666666666, y: 4.416666666666666, w: 1.25, d: 1.8333333333333333, h: 0.41666666666666663, z: 1.8333333333333333, color: '#849676', zOrders: {"0": 5} },
    { id: 'f-mq2m424n0', label: 'New piece', x: 11.416666666666666, y: 6.833333333333333, w: 1.25, d: 1.8333333333333333, h: 0.41666666666666663, z: 1.8333333333333333, color: '#849676', zOrders: {"0": 5} },
    { id: 'f-mq2m48rq', label: 'New piece', x: 9.75, y: 2.75, w: 2.333333333333333, d: 1.2500000000000004, h: 2.5, color: '#e8d8b0' },
    { id: 'f-mq2m5ip9', label: 'New piece', x: 0.08333333333333333, y: 4.083333333333333, w: 1.6666666666666665, d: 2.5, h: 1, color: '#ffffff' },
    { id: 'f-mq2m71ai0', label: 'New piece', x: 0.08333333333333333, y: 4.083333333333333, w: 1.6666666666666665, d: 2.5, h: 1, z: 1, color: '#ffffff' },
    { id: 'f-mq2m771j0', label: 'New piece', x: 0.08333333333333333, y: 4.083333333333333, w: 1.6666666666666665, d: 2.5, h: 1, z: 2, color: '#ffffff' },
    { id: 'f-mq2m7dna0', label: 'New piece', x: 0.08333333333333333, y: 6.583333333333333, w: 1.6666666666666665, d: 2.5, h: 1, z: 0, color: '#ffffff' },
    { id: 'f-mq2m7lsk0', label: 'New piece', x: 0.08333333333333333, y: 6.583333333333333, w: 1.6666666666666665, d: 2.5, h: 1, z: 1, color: '#ffffff' },
    { id: 'f-mq2m7pab0', label: 'New piece', x: 0.08333333333333333, y: 6.583333333333333, w: 1.6666666666666665, d: 2.5, h: 1, z: 2, color: '#ffffff' },
    { id: 'f-mq2m82hj0', label: 'Bedroom Dresser', x: 0.08333333333333333, y: 4.083333333333333, w: 1.6666666666666665, d: 5, h: 0.08333333333333333, z: 3, color: '#ffffff', storage: true },
    { id: 'f-mq2mbduh', label: 'New piece', shape: 'circle', x: 0.75, y: 0.8333333333333333, w: 2, d: 2, h: 1.8333333333333333, color: '#e1bb80' },
    { id: 'f-mq2nhcxv', label: 'New piece', x: 4.75, y: 12, w: 8.333333333333332, d: 2.083333333333332, h: 4, color: '#e0e0de' },
  ],
  roommppwldav: [
    { id: 'f-mq2n7osu', label: 'New piece', x: 2.9166666666666665, y: 6.75, w: 5.5, d: 2.75, h: 2.083333333333333, color: '#ffffff', zOrders: {"0": 6} },
    { id: 'f-mq2n8ht9', label: 'New piece', shape: 'circle', x: 3.333333333333333, y: 7, w: 4.833333333333333, d: 2.1666666666666665, h: 0.08333333333333333, z: 2, color: '#ebebeb', zOrders: {"0": 7} },
    { id: 'f-mq2n9skt', label: 'New piece', shape: 'circle', x: 7.5, y: 4.833333333333333, w: 2, d: 1.25, h: 1.5, color: '#ffffff', storage: false, zOrders: {"0": 5} },
    { id: 'f-mq2nag24', label: 'New piece', x: 9.083333333333332, y: 4.666666666666666, w: 0.6666666666666666, d: 1.5, h: 1.5, z: 1.25, color: '#ffffff', zOrders: {"0": 8} },
    { id: 'f-mq2nbptv', label: 'New piece', x: 7.666666666666666, y: 0.08333333333333333, w: 2.083333333333333, d: 4, h: 2.5, color: '#ece0c8', zOrders: {"0": 3} },
    { id: 'f-mq2nccjd', label: 'New piece', shape: 'circle', x: 8.083333333333332, y: 1.5, w: 1.4166666666666665, d: 1.75, h: 0.08333333333333333, z: 2.5, color: '#ffffff', zOrders: {"0": 4} },
    { id: 'f-mq2neqem', label: 'New piece', x: 8.166666666666666, y: 0.08333333333333333, w: 1.1666666666666665, d: 0.08333333333333333, h: 2.333333333333333, z: 3, color: '#d6d6d6', zOrders: {"0": 9} },
    { id: 'f-mq2nfkla', label: 'New piece', x: 1.25, y: 0, w: 8.5, d: 0.08333333333333333, h: 6.083333333333333, color: '#e0d2b6', zOrders: {"0": 1} },
    { id: 'f-mq2ni5u2', label: 'New piece', x: 0, y: 5.166666666666666, w: 1.0833333333333333, d: 1.4166666666666665, h: 5, color: '#ffffff', zOrders: {"0": 2} },
    { id: 'f-mq2nirqr0', label: 'New piece', x: 0, y: 3.75, w: 1.0833333333333333, d: 1.3333333333333333, h: 5, color: '#ffffff', zOrders: {"0": 0} },
    { id: 'f-mq2nj8ly0', label: 'New piece', x: 0, y: 3.75, w: 1.0833333333333333, d: 2.833333333333333, h: 0.08333333333333333, z: 5, color: '#ffffff', zOrders: {"0": 10} },
  ],
};

// Storage areas keyed by room id. Each id doubles as the Notion "Container ID".
let STORAGE_AREAS = {
  roommppoommb: [
    { id: 'f-mpw6n5oj', label: 'Fridge', furniture: 'f-mpw6n5oj', face: 'front2', items: 0 },
    { id: 'f-mpw6qha4', label: 'Pantry', furniture: 'f-mpw6qha4', face: 'front2', items: 0 },
    { id: 'f-mpw6fek4', label: 'Island', furniture: 'f-mpw6fek4', face: 'top', items: 0 },
  ],
  roommppvoge9: [
    { id: 'f-mpusy685', label: 'Shelf', furniture: 'f-mpusy685', face: 'front', items: 0 },
    { id: 'f-mpw1lqs30', label: 'New piece', furniture: 'f-mpw1lqs30', face: 'top', items: 0 },
    { id: 'f-mpuszg0c', label: 'New piece', furniture: 'f-mpuszg0c', face: 'top', items: 0 },
  ],
  roommppwbopp: [
    { id: 'f-mpx9i8x2', label: 'Medicine Cabinet', furniture: 'f-mpx9i8x2', face: 'front2', items: 0 },
  ],
  bedroom1: [
    { id: 'f-mq2m82hj0', label: 'Bedroom Dresser', furniture: 'f-mq2m82hj0', face: 'front', items: 0 },
  ],
};

// Live inventory, loaded from the Notion-backed API, keyed by container id
// (== storage-area id). Shape: { [containerId]: [{ id, name, quantity, notes }] }.
// App reassigns this each render (like APARTMENT) so any component reading the
// bare identifier sees live data. The legacy scalar `area.items` is a fallback
// for when the API hasn't loaded (offline).
let INVENTORY = {};

// Live count for a storage area: prefer real loaded items, fall back to the
// legacy scalar count.
function itemCount(area) {
  if (!area) return 0;
  const list = INVENTORY[area.id];
  return list ? list.length : (area.items || 0);
}

// Saved furniture — assemblies the user has built once and wants again in
// another room (the same flat-pack cabinet stands in three rooms here). Each
// entry holds its pieces with coordinates relative to its own bounding box;
// placing one mints fresh ids. Empty by default: this is a library the user
// builds, not apartment geometry, so it lives in the plan rather than here.
// Reassigned by App each render, like the globals above.
let CATALOG = [];

Object.assign(window, { PALETTE, DEFAULT_THEME, STOCK_BG_GRADIENT, FALLBACK_FLOOR, THEME,
  themeFloor, themeWall, themePlinth,
  APARTMENT, HOME_FURNITURE, STORAGE_AREAS, INVENTORY, CATALOG, itemCount });
