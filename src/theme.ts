/**
 * Centralized color theme inspired by Fusion 360's visual style.
 * All color constants for the application are defined here.
 */

// ── Scene ──────────────────────────────────────────────────────────
export const SCENE = {
  backgroundTop: 0xe8e8e8,
  backgroundBottom: 0xc0c0c0,
  gridMajor: 0xcccccc,
  gridMinor: 0xdddddd,
  groundPlane: 0xf0f0f0,
  groundPlaneOpacity: 0.15,
} as const;

// ── Lighting ───────────────────────────────────────────────────────
export const LIGHTING = {
  ambient: { color: 0xffffff, intensity: 0.45 },
  hemisphereTop: 0xf0f0f0,
  hemisphereBottom: 0xd0cfc8,
  hemisphereIntensity: 0.4,
  keyLight: { color: 0xffffff, intensity: 0.7, position: [8, 10, 10] as const },
  fillLight: { color: 0xffffff, intensity: 0.25, position: [-6, -4, 8] as const },
} as const;

// ── 3D Bodies ──────────────────────────────────────────────────────
export const BODY = {
  default: 0xa8a9ad,       // Steel satin gray
  edge: 0x333333,          // Dark gray edges (always visible)
  edgeOpacity: 1.0,
  selected: 0x2e75b6,      // Blue selection
  hover: 0x4a90d9,         // Blue pre-selection (lighter)
  dimmedOpacity: 0.25,     // Opacity when bodies are dimmed (sketch mode)
  dimmedColor: 0xb8b8b8,  // Slightly lighter gray when dimmed
} as const;

// ── Selection ──────────────────────────────────────────────────────
export const SELECTION = {
  selected: 0x2e75b6,      // Blue
  hover: 0x4a90d9,         // Lighter blue
} as const;

// ── Sketch Mode ────────────────────────────────────────────────────
export const SKETCH = {
  underconstrained: 0x1e90ff,  // Dodger blue (like Fusion 360)
  constrained: 0x111111,       // Near-black
  overconstrained: 0xff0000,   // Red
  preview: 0x1e90ff,           // Blue preview while drawing
  point: 0xffffff,             // White (Fusion 360 style)
  pointConstrained: 0x111111,  // Dark (constrained point)
  selected: 0x2e75b6,          // Blue selection
  selectedLine: 0x2e75b6,      // Blue selected line
  selectedPoint: 0x5ba3e0,     // Lighter blue selected point
  profileHover: 0x87ceeb,      // Light blue profile fill on hover
  profileHoverOpacity: 0.3,
  profileFill: 0x87ceeb,       // Translucent blue closed profile fill
  profileFillOpacity: 0.15,
  construction: 0xff8800,          // Orange construction lines
  constructionSelected: 0xffaa44,  // Selected construction lines
  constraintGlyph: 0xddaa00,      // Gold for constraint symbols
  constraintGlyphBg: 0x333333,    // Dark background circle
  trimHighlight: 0xff4444,        // Red for segment to be removed
  extendPreview: 0x44ff44,        // Green for extension preview line
} as const;

// ── Sketch Inference Glyphs ────────────────────────────────────────
export const INFERENCE = {
  endpoint: 0x00cc44,     // Green (Fusion 360 style)
  midpoint: 0x00cc44,     // Green
  center: 0x00cc44,       // Green
  quadrant: 0x00cc44,     // Green
  intersection: 0x00cc44, // Green
  default: 0x00cc44,      // Green
  guidelineChain: 0x00bcd4, // Teal for chain guidelines
  guidelinePoint: 0x5ba3e0, // Soft blue for point guidelines
} as const;

// ── Sketch Plane Selection ─────────────────────────────────────────
export const SKETCH_PLANE = {
  xy: 0x4488ff,
  xz: 0x44ff88,
  yz: 0xff6644,
  hover: 0xffff44,
  xAxis: 0xff4444,
  yAxis: 0x44ff44,
  zAxis: 0x4488ff,
  edge: 0xffffff,
  origin: 0xffffff,
  grid: 0x888888,
  gridMajor: 0xbbbbbb,
  gridMinor: 0xd0d0d0,
} as const;

// ── Extrude Mode ───────────────────────────────────────────────────
export const EXTRUDE = {
  arrow: 0x2e75b6,          // Blue arrows instead of green
  arrowSecondary: 0x2e75b6, // Same blue, lower opacity
  profileHighlight: 0x87ceeb,
  cutArrow: 0xcc3333,          // Red arrows for cut direction
  cutArrowSecondary: 0xcc3333, // Same red, lower opacity
  cutPreview: 0xff6b6b,        // Light red/salmon preview volume
} as const;

// ── Fillet / Chamfer Mode ──────────────────────────────────────────
export const FILLET = {
  edgeHighlight: 0xff8800,   // Orange — selected edges
  edgeHover: 0xffaa44,       // Lighter orange — hovered edge
  preview: 0xa8a9ad,         // Body default for preview mesh
  previewOpacity: 0.6,
} as const;

// ── Sweep Mode ─────────────────────────────────────────────────────
export const SWEEP = {
  pathPreview: 0x2e75b6,
  pathPoint: 0x4a90d9,
  profileHighlight: 0x87ceeb,
  preview: 0xa8a9ad,
  previewOpacity: 0.6,
} as const;

// ── Loft Mode ──────────────────────────────────────────────────────
export const LOFT = {
  profileHighlight: 0x2e75b6,
  profileHover: 0x4a90d9,
  preview: 0xa8a9ad,
  previewOpacity: 0.6,
} as const;

// ── Revolve Mode ──────────────────────────────────────────────────
export const REVOLVE = {
  axisLine: 0xff8800,          // Orange axis line
  axisHover: 0xffaa44,         // Lighter orange on hover
  profileHighlight: 0x87ceeb,  // Same as extrude
  preview: 0xa8a9ad,           // Body default for preview
  previewOpacity: 0.6,
} as const;

// ── Resize Mode ────────────────────────────────────────────────────
export const RESIZE = {
  handle: 0xffcc00,       // Yellow handle
  previewWireframe: 0xff00ff, // Magenta wireframe
  previewSolid: 0xffcc00,    // Yellow solid
} as const;

// ── Debug / Wireframe ──────────────────────────────────────────────
export const DEBUG = {
  wireframe: 0x666666,    // Neutral gray wireframe (was green)
} as const;

// ── Draw Mode ──────────────────────────────────────────────────────
export const DRAW = {
  preview: 0x87ceeb,      // Light blue preview
  previewOpacity: 0.5,
} as const;

// ── ViewCube ──────────────────────────────────────────────────────
export const VIEWCUBE = {
  face: 0x5a5a5a,           // Medium gray face
  faceHover: 0x6a8abf,      // Blue-gray on hover
  faceBorder: 0x444444,      // Dark gray edge lines
  text: "#e0e0e0",          // Light text on faces (CSS color)
  textBold: "#ffffff",       // Active/hovered text
  background: 0x2a2a2a,     // Dark background for the mini scene
} as const;

// ── Helpers ────────────────────────────────────────────────────────
export const HELPERS = {
  edgeColor: 0x555555,    // Subtle dark gray edges (was cyan)
  vertexColor: 0xff4444,  // Soft red vertices
} as const;
