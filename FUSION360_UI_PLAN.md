# Plan: Fusion 360-Style Sketch Mode UI Overhaul

## Context

The sketch mode UI looks "weird" compared to Fusion 360 - particularly the helper lines (rendered as thick 3D tubes), snap indicators (wrong colors, oversized), and point markers (too large). This plan addresses all visual discrepancies across 6 tiers, from most to least impactful.

## Scope
- **Sketch mode only** (not Draw mode)
- **Line2/LineMaterial** for variable-width lines (~1.5-2px)
- **All 6 tiers** - full visual overhaul

---

## Tier 1: Replace Thick Tube Lines with Thin Line2

**Problem**: Lines use `CylinderGeometry(0.05)` creating thick 3D sausages. Fusion 360 uses crisp ~2px lines.

**Files**: `src/hooks/useSketchMode.ts`, possibly new import setup

**Changes**:
1. Add imports for `Line2`, `LineMaterial`, `LineGeometry` from `three/examples/jsm/lines/`
2. Replace line rendering (~line 2358-2396) - swap CylinderGeometry for `Line2` with `LineMaterial({ linewidth: 1.5 })` (unselected) / `3.0` (selected)
3. Replace circle rendering (~line 2400-2422) - swap LineBasicMaterial for `Line2` + `LineGeometry` with positions array
4. Replace arc rendering (~line 2423-2454) - same Line2 approach
5. Update preview functions (`createLinePreview` ~line 545, `createCirclePreview` ~line 558, `createArcPreview` ~line 583) to use Line2
6. Handle `LineMaterial.resolution` - set to `(window.innerWidth, window.innerHeight)` and update on resize
7. Verify raycasting still works for selection (Line2 extends Mesh) - add threshold if needed

---

## Tier 2: Fix Points, Snap Colors, Snap Sizes

### 2A. Reduce point sizes
**File**: `src/hooks/useSketchMode.ts` (~line 2345-2357)
- Change from `SphereGeometry(0.2/0.25)` to `CircleGeometry(0.07/0.1)` for flat 2D look
- Update `SKETCH_CONFIG.POINT_SIZE` (line ~85) from 0.15 to 0.08

### 2B. Fix point colors
**File**: `src/theme.ts` (line 49)
- Change `point: 0xeeeeee` to `point: 0xffffff` (white, matching Fusion 360)

### 2C. Fix snap indicator colors - ALL GREEN
**File**: `src/theme.ts` (lines 59-68)
- Change ALL snap colors to green `0x00cc44`:
  - `endpoint`, `midpoint`, `center`, `quadrant`, `intersection`, `default` -> `0x00cc44`
  - Keep `guidelineChain` (0x00bcd4) and `guidelinePoint` (0x5ba3e0) as-is

### 2D. Reduce snap indicator sizes (~40-50% smaller)
**File**: `src/hooks/useSketchMode.ts` - `renderInferencePoint()` (~lines 435-501)

| Glyph | Current | New |
|-------|---------|-----|
| endpoint (Box) | 0.15x0.15x0.05 | 0.09x0.09x0.02 |
| midpoint (triangle) | 0.1 height | 0.06 height |
| center (Circle) | r=0.08 | r=0.05 |
| quadrant (diamond) | 0.08 | 0.05 |
| intersection (Box) | 0.12x0.12x0.05 | 0.07x0.07x0.02 |

---

## Tier 3: Constraint Glyphs on Geometry

**Problem**: Fusion 360 shows small gold/yellow symbols (H, V, perpendicular, //, =, etc.) directly on constrained geometry. Currently only in sidebar.

**Files**: `src/hooks/useSketchMode.ts`, `src/theme.ts`

**Changes**:
1. Add new theme colors in `src/theme.ts`:
   ```
   constraintGlyph: 0xddaa00      // Gold for constraint symbols
   constraintGlyphBg: 0x333333    // Dark background circle
   ```
2. Create `createConstraintGlyph(text, position)` helper using `THREE.Sprite` + `CanvasTexture`:
   - 64x64 canvas, dark circle background, gold text
   - Scale 0.3, renderOrder 1001, depthTest false
3. After primitive rendering loop (~line 2456), iterate `activeSketch.constraints`:
   - Map constraint type to glyph text: H, V, perpendicular, //, =, T, M, etc.
   - Position at midpoint of first referenced primitive, offset perpendicular to line
   - Add sprites to scene and newObjects array
4. Handle Sprite cleanup (dispose texture + material)
5. Stagger multiple constraint glyphs on same primitive to avoid overlap

---

## Tier 4: Construction Line Support

**Problem**: Missing entirely. Fusion 360 toggles with X key - lines become orange dashed, excluded from profiles.

### 4A. Add `construction?: boolean` to primitive types
**File**: `src/types/sketch-types.ts`
- Add optional `construction` field to `SketchLine`, `SketchCircle`, `SketchArc`

### 4B. Add construction theme colors
**File**: `src/theme.ts`
- Add `construction: 0xff8800` and `constructionSelected: 0xffaa44`

### 4C. Add X key toggle
**File**: `src/hooks/useSketchMode.ts` - `handleKeyDown` (~line 1548)
- Case "x": Toggle `construction` flag on selected primitives via `updatePrimitive`

### 4D. Render construction lines differently
**File**: `src/hooks/useSketchMode.ts` - line rendering block
- If `primitive.construction`: use orange color + `LineMaterial({ dashed: true, dashSize: 0.15, gapSize: 0.1 })`

### 4E. Exclude from BRep conversion
**File**: `src/services/SketchToBrepService.ts`
- Filter out primitives with `construction: true` before building edges

### 4F. Add toolbar button
**File**: `src/navbar/SketchToolbar.tsx`
- Add "Construction (X)" toggle button

---

## Tier 5: Closed Profile Fill Detection

**Problem**: Fusion 360 fills closed sketch regions with translucent blue. Currently no real-time profile detection.

**Files**: `src/hooks/useSketchMode.ts`, `src/theme.ts`

**Changes**:
1. Add theme colors: `profileFill: 0x87ceeb`, `profileFillOpacity: 0.15`
2. Create `detectClosedProfiles(sketch)` utility:
   - Build point-to-edge adjacency from non-construction lines/arcs
   - Find closed loops (can adapt the half-edge "leftmost turn" algorithm from `SketchToBrepService`)
   - Return arrays of point coordinates for each closed region
3. In sketch visualization effect, after primitives rendering:
   - For each closed profile, create `THREE.Shape` + `ShapeGeometry`
   - Render with `MeshBasicMaterial({ color: profileFill, opacity: 0.15, transparent: true })`
   - Place at renderOrder 997, slightly behind sketch lines
4. Only recompute when primitives change (effect dependency array handles this)

---

## Tier 6: Dimension Display + Guideline Polish

### 6A. Dimension display with extension lines
**File**: `src/components/DimensionInput.tsx`, `src/hooks/useSketchMode.ts`
- For dimensional constraints (distance, angle, radius), render:
  - Extension lines from geometry endpoints (thin Line2)
  - Dimension line with arrowheads between extension lines
  - Value text on/near the dimension line
- This integrates with the constraint glyph system from Tier 3

### 6B. Guideline dash pattern refinement
**File**: `src/hooks/useSketchMode.ts` (~lines 524-531)
- Adjust `LineDashedMaterial`: `dashSize: 0.15`, `gapSize: 0.08`, `opacity: 0.6`
- Consider converting guidelines to Line2 for consistent width

---

## Key Files Summary

| File | Tiers | Purpose |
|------|-------|---------|
| `src/hooks/useSketchMode.ts` | 1,2A,2D,3,4C,4D,5,6 | Core sketch rendering, keyboard, inference |
| `src/theme.ts` | 2B,2C,3,4B,5 | Color constants |
| `src/hooks/useSketchInference.ts` | (read-only ref) | Inference logic (rendering is in useSketchMode) |
| `src/types/sketch-types.ts` | 4A | Primitive type definitions |
| `src/services/SketchToBrepService.ts` | 4E | BRep conversion (filter construction) |
| `src/navbar/SketchToolbar.tsx` | 4F | Toolbar UI |
| `src/components/DimensionInput.tsx` | 6A | Dimension popup |

## Risks & Mitigations

1. **Line2 raycasting**: Test selection after migration. Add hit-test threshold if thin lines are hard to click.
2. **LineMaterial.resolution**: Must update on window resize or lines render wrong width.
3. **Construction flag**: Optional field, backward compatible with existing sketches.
4. **Profile detection perf**: Only recompute on primitive changes, cache results.
5. **Constraint glyph overlap**: Stagger positions when multiple constraints share a primitive.

## Fusion 360 Reference Colors

| Element | Fusion 360 | Current CADjs | Action |
|---------|-----------|---------------|--------|
| Under-constrained lines | Dodger Blue (#1E90FF) | #1E90FF | OK - matches |
| Fully constrained lines | Black (#111111) | #111111 | OK - matches |
| Over-constrained lines | Red (#FF0000) | #FF0000 | OK - matches |
| Construction lines | Orange dashed (#FF8C00) | N/A | ADD |
| Snap indicators (all) | Green (#00CC44) | Multi-colored | FIX to green |
| Unconstrained points | White | Light gray (#EEEEEE) | FIX to white |
| Constraint glyphs | Gold (#DDAA00) | N/A | ADD |
| Profile fill | Translucent blue | N/A | ADD |
| Line thickness | ~2px thin lines | Thick 3D tubes | FIX to Line2 |
| Point size | Small dots | Large spheres (0.2) | FIX to 0.07-0.1 |

## Verification

1. `npm run dev` - Start dev server
2. Enter Sketch mode, select XY plane
3. Draw lines forming a rectangle - verify:
   - Lines are thin (~2px), not thick tubes
   - Points are small flat circles
   - Snap indicators are green, small
   - Horizontal/vertical constraint glyphs (H/V) appear on auto-constrained lines
   - Closed rectangle fills with translucent blue
4. Press X on a selected line - verify it turns orange dashed (construction)
5. Add dimensions - verify extension lines and arrowheads
6. Finish sketch, extrude - verify construction lines are excluded from BRep
7. Run `npm test` to verify no regressions
