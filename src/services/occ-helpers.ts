/**
 * Pure OCC helper functions extracted from OpenCascadeService.
 * Each takes `oc: OpenCascadeInstance` as the first parameter.
 * Used by both the worker handlers and (during migration) OpenCascadeService.
 * NO THREE.js imports — returns raw arrays/plain objects.
 */

import type {
  OpenCascadeInstance,
  TopoDS_Shape,
  TopoDS_Wire,
  TopoDS_Edge,
  TopoDS_Face,
  gp_Pnt_3,
} from "opencascade.js";
import type { BrepJSON, VertexJSON } from "../geometry";
import type { Vec3, EulerJSON } from "../workers/occ-worker-types";
import type { SketchPrimitive, SketchLine, SketchCircle, SketchArc, SketchPlane } from "../types/sketch-types";

// ─── BRep bounds calculation ──────────────────────────────────────

export interface BrepBounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

export function calculateBrepBoundsFromJSON(brepJson: BrepJSON): BrepBounds {
  const bounds: BrepBounds = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };

  for (const v of brepJson.vertices) {
    bounds.minX = Math.min(bounds.minX, v.x);
    bounds.maxX = Math.max(bounds.maxX, v.x);
    bounds.minY = Math.min(bounds.minY, v.y);
    bounds.maxY = Math.max(bounds.maxY, v.y);
    bounds.minZ = Math.min(bounds.minZ, v.z);
    bounds.maxZ = Math.max(bounds.maxZ, v.z);
  }

  return bounds;
}

// ─── Shape conversion: BRep JSON → OCC Shape ─────────────────────

function createPolygonWireHelper(oc: OpenCascadeInstance, points: gp_Pnt_3[]): TopoDS_Wire {
  if (points.length < 2) throw new Error("Need at least two points for a wire");
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    if (edge.IsDone()) wireBuilder.Add_1(edge.Edge());
  }
  if (wireBuilder.IsDone()) return oc.TopoDS.Wire_1(wireBuilder.Wire());
  throw new Error(`Failed to create wire: ${wireErrorToString(oc, wireBuilder)}`);
}

function isCircularFaceHelper(vertices: VertexJSON[]): { center: Vec3; radius: number; normal: Vec3 } | null {
  if (vertices.length < 8) return null;

  const xs = vertices.map(v => v.x);
  const ys = vertices.map(v => v.y);
  const zs = vertices.map(v => v.z);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeY = Math.max(...ys) - Math.min(...ys);
  const rangeZ = Math.max(...zs) - Math.min(...zs);

  let u: "x" | "y" | "z", v: "x" | "y" | "z";
  let normal: Vec3;

  if (rangeX < 0.01) { u = "y"; v = "z"; normal = { x: 1, y: 0, z: 0 }; }
  else if (rangeY < 0.01) { u = "x"; v = "z"; normal = { x: 0, y: 1, z: 0 }; }
  else if (rangeZ < 0.01) { u = "x"; v = "y"; normal = { x: 0, y: 0, z: 1 }; }
  else return null;

  const cx = vertices.reduce((s, vert) => s + vert.x, 0) / vertices.length;
  const cy = vertices.reduce((s, vert) => s + vert.y, 0) / vertices.length;
  const cz = vertices.reduce((s, vert) => s + vert.z, 0) / vertices.length;
  const center = { x: cx, y: cy, z: cz };

  const distances = vertices.map(vert =>
    Math.sqrt((vert[u] - center[u]) ** 2 + (vert[v] - center[v]) ** 2)
  );
  const avgRadius = distances.reduce((s, d) => s + d, 0) / distances.length;
  if (avgRadius < 1e-6) return null;
  const allOnCircle = distances.every(d => Math.abs(d - avgRadius) / avgRadius < 0.01);
  if (!allOnCircle) return null;
  return { center, radius: avgRadius, normal };
}

function createSolidFromBrepJSON(oc: OpenCascadeInstance, brepJson: BrepJSON): TopoDS_Shape {
  const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  for (const face of brepJson.faces) {
    if (face.vertices.length < 3) continue;
    const ocPoints: gp_Pnt_3[] = face.vertices.map(v => new oc.gp_Pnt_3(v.x, v.y, v.z));
    const polygonWire = createPolygonWireHelper(oc, ocPoints);
    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(polygonWire, true);
    if (faceBuilder.IsDone()) sewing.Add(faceBuilder.Face());
    ocPoints.forEach(p => p.delete());
  }
  const progressRange = new oc.Message_ProgressRange_1();
  sewing.Perform(progressRange);
  const sewnShape = sewing.SewedShape();

  try {
    const solidMaker = new oc.BRepBuilderAPI_MakeSolid_1();
    const shellExplorer = new oc.TopExp_Explorer_2(
      sewnShape, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    if (shellExplorer.More()) {
      const shell = oc.TopoDS.Shell_1(shellExplorer.Current());
      solidMaker.Add(shell);
      const solid = solidMaker.Solid();
      try { oc.BRepLib.OrientClosedSolid(solid); } catch { /* not orientable */ }
      return solid;
    }
  } catch { /* fall through */ }
  return sewnShape;
}

function createShellFromBrepJSON(oc: OpenCascadeInstance, brepJson: BrepJSON): TopoDS_Shape {
  const builder = new oc.BRep_Builder();
  const compound = new oc.TopoDS_Compound();
  builder.MakeCompound(compound);
  let faceCount = 0;
  let lastFace: TopoDS_Face | null = null;

  // Check for circular shape
  const allUniqueVerts = new Map<string, VertexJSON>();
  for (const face of brepJson.faces) {
    for (const v of face.vertices) {
      const key = `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
      allUniqueVerts.set(key, v);
    }
  }
  const circleInfo = isCircularFaceHelper(Array.from(allUniqueVerts.values()));

  if (circleInfo) {
    const centerPnt = new oc.gp_Pnt_3(circleInfo.center.x, circleInfo.center.y, circleInfo.center.z);
    const dir = new oc.gp_Dir_4(circleInfo.normal.x, circleInfo.normal.y, circleInfo.normal.z);
    const axis = new oc.gp_Ax2_3(centerPnt, dir);
    const circ = new oc.gp_Circ_2(axis, circleInfo.radius);
    const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_8(circ);
    const edge = edgeBuilder.Edge();
    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_2(edge);
    const wire = wireBuilder.Wire();
    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
    if (faceBuilder.IsDone()) {
      centerPnt.delete(); dir.delete(); axis.delete();
      return faceBuilder.Face();
    }
    centerPnt.delete(); dir.delete(); axis.delete();
  }

  for (const face of brepJson.faces) {
    if (face.vertices.length < 3) continue;
    const ocPoints: gp_Pnt_3[] = face.vertices.map(v => new oc.gp_Pnt_3(v.x, v.y, v.z));
    const polygonWire = createPolygonWireHelper(oc, ocPoints);
    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(polygonWire, true);
    if (faceBuilder.IsDone()) {
      const ocFace = faceBuilder.Face();
      builder.Add(compound, ocFace);
      lastFace = ocFace;
      faceCount++;
    }
    ocPoints.forEach(p => p.delete());
  }
  if (faceCount === 1 && lastFace) return lastFace;
  return compound;
}

/**
 * Convert BRep JSON to OCC shape, optionally translating to a world position.
 * Mirrors OpenCascadeService.brepToOCShape().
 */
export function brepToOCShapeHelper(
  oc: OpenCascadeInstance,
  brepJson: BrepJSON,
  position?: Vec3,
): TopoDS_Shape {
  let workingBrepJson = brepJson;

  if (position) {
    const bounds = calculateBrepBoundsFromJSON(brepJson);
    const actualCenterX = (bounds.minX + bounds.maxX) / 2;
    const actualCenterY = (bounds.minY + bounds.maxY) / 2;
    const actualCenterZ = (bounds.minZ + bounds.maxZ) / 2;
    const needsTranslation = Math.abs(actualCenterX - position.x) > 1e-9
      || Math.abs(actualCenterY - position.y) > 1e-9
      || Math.abs(actualCenterZ - position.z) > 1e-9;

    if (needsTranslation) {
      const dx = position.x - actualCenterX;
      const dy = position.y - actualCenterY;
      const dz = position.z - actualCenterZ;
      workingBrepJson = {
        ...brepJson,
        vertices: brepJson.vertices.map(v => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz })),
        edges: brepJson.edges.map(e => ({
          start: { x: e.start.x + dx, y: e.start.y + dy, z: e.start.z + dz },
          end: { x: e.end.x + dx, y: e.end.y + dy, z: e.end.z + dz },
        })),
        faces: brepJson.faces.map(f => ({
          vertices: f.vertices.map(v => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz })),
        })),
      };
    }
  }

  const xs = workingBrepJson.vertices.map(v => v.x);
  const ys = workingBrepJson.vertices.map(v => v.y);
  const zs = workingBrepJson.vertices.map(v => v.z);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeY = Math.max(...ys) - Math.min(...ys);
  const rangeZ = Math.max(...zs) - Math.min(...zs);
  const thickAxes = (rangeX > 0.01 ? 1 : 0) + (rangeY > 0.01 ? 1 : 0) + (rangeZ > 0.01 ? 1 : 0);
  const is3D = thickAxes >= 2;

  if (is3D) return createSolidFromBrepJSON(oc, workingBrepJson);
  return createShellFromBrepJSON(oc, workingBrepJson);
}

// ─── Shape → BRep JSON conversion ────────────────────────────────

function getOrCreateVertexHelper(
  vertexMap: Map<string, VertexJSON>,
  x: number, y: number, z: number,
  allVertices: VertexJSON[],
): VertexJSON {
  const key = `${x.toFixed(7)},${y.toFixed(7)},${z.toFixed(7)}`;
  if (vertexMap.has(key)) return vertexMap.get(key)!;
  const vertex = { x, y, z };
  vertexMap.set(key, vertex);
  allVertices.push(vertex);
  return vertex;
}

/**
 * Convert OCC shape to BRep JSON. Optionally centers at origin.
 * Mirrors OpenCascadeService.ocShapeToBRep().
 */
export function ocShapeToBRepHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  centerAtOrigin: boolean = true,
): { brepJson: BrepJSON; center: Vec3 } {
  const vertexMap = new Map<string, VertexJSON>();
  interface EdgeJSON_ { start: VertexJSON; end: VertexJSON }
  interface FaceJSON_ { vertices: VertexJSON[] }
  const edges: EdgeJSON_[] = [];
  const faces: FaceJSON_[] = [];
  const allVertices: VertexJSON[] = [];

  try { oc.BRepTools.Clean(shape, true); } catch { /* ok */ }
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.01, false, 0.1, true);

  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const startPnt = curve.Value(curve.FirstParameter());
    const endPnt = curve.Value(curve.LastParameter());
    const v1 = getOrCreateVertexHelper(vertexMap, startPnt.X(), startPnt.Y(), startPnt.Z(), allVertices);
    const v2 = getOrCreateVertexHelper(vertexMap, endPnt.X(), endPnt.Y(), endPnt.Z(), allVertices);
    const edgeKey = `${v1.x.toFixed(5)},${v1.y.toFixed(5)},${v1.z.toFixed(5)}-${v2.x.toFixed(5)},${v2.y.toFixed(5)},${v2.z.toFixed(5)}`;
    // Deduplicate edges
    const reverseKey = `${v2.x.toFixed(5)},${v2.y.toFixed(5)},${v2.z.toFixed(5)}-${v1.x.toFixed(5)},${v1.y.toFixed(5)},${v1.z.toFixed(5)}`;
    const exists = edges.some(e => {
      const ek = `${e.start.x.toFixed(5)},${e.start.y.toFixed(5)},${e.start.z.toFixed(5)}-${e.end.x.toFixed(5)},${e.end.y.toFixed(5)},${e.end.z.toFixed(5)}`;
      return ek === edgeKey || ek === reverseKey;
    });
    if (!exists) edges.push({ start: v1, end: v2 });
    edgeExplorer.Next();
  }

  const faceExplorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);
    if (!triangulation.IsNull()) {
      const transformation = location.Transformation();
      const nbTriangles = triangulation.get().NbTriangles();
      const isReversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      for (let i = 1; i <= nbTriangles; i++) {
        const triangle = triangulation.get().Triangle(i);
        const p1 = triangulation.get().Node(triangle.Value(1)).Transformed(transformation);
        const p2 = triangulation.get().Node(triangle.Value(2)).Transformed(transformation);
        const p3 = triangulation.get().Node(triangle.Value(3)).Transformed(transformation);
        const v1 = getOrCreateVertexHelper(vertexMap, p1.X(), p1.Y(), p1.Z(), allVertices);
        const v2 = getOrCreateVertexHelper(vertexMap, p2.X(), p2.Y(), p2.Z(), allVertices);
        const v3 = getOrCreateVertexHelper(vertexMap, p3.X(), p3.Y(), p3.Z(), allVertices);
        if (isReversed) faces.push({ vertices: [v1, v3, v2] });
        else faces.push({ vertices: [v1, v2, v3] });
      }
    }
    faceExplorer.Next();
  }

  let center: Vec3 = { x: 0, y: 0, z: 0 };
  if (centerAtOrigin && allVertices.length > 0) {
    const bounds = calculateBrepBoundsFromJSON({ vertices: allVertices, edges: [], faces: [] });
    center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    };
    // Translate to origin
    for (const v of allVertices) {
      v.x -= center.x;
      v.y -= center.y;
      v.z -= center.z;
    }
  }

  return {
    brepJson: { type: "brep", vertices: allVertices, edges, faces },
    center,
  };
}

// ─── Serialization ────────────────────────────────────────────────

export function serializeShapeHelper(oc: OpenCascadeInstance, shape: TopoDS_Shape): string {
  const filePath = "/tmp/occ_brep_out.brep";
  const progress = new oc.Message_ProgressRange_1();
  try {
    const success = oc.BRepTools.Write_3(shape, filePath, progress);
    if (!success) throw new Error("BRepTools.Write_3 failed");
    return oc.FS.readFile(filePath, { encoding: "utf8" }) as string;
  } finally {
    try { oc.FS.unlink(filePath); } catch { /* ignore */ }
    progress.delete();
  }
}

export function deserializeShapeHelper(oc: OpenCascadeInstance, brepString: string): TopoDS_Shape {
  const filePath = "/tmp/occ_brep_in.brep";
  const progress = new oc.Message_ProgressRange_1();
  try {
    oc.FS.writeFile(filePath, brepString);
    const builder = new oc.BRep_Builder();
    const shape = new oc.TopoDS_Shape();
    const success = oc.BRepTools.Read_2(shape, filePath, builder, progress);
    if (!success) { shape.delete(); throw new Error("BRepTools.Read_2 failed"); }
    return shape;
  } finally {
    try { oc.FS.unlink(filePath); } catch { /* ignore */ }
    progress.delete();
  }
}

/**
 * Deserialize occBrep and optionally translate to world position.
 */
export function occBrepToOCShapeHelper(
  oc: OpenCascadeInstance,
  occBrep: string,
  position?: Vec3,
): TopoDS_Shape {
  let shape = deserializeShapeHelper(oc, occBrep);
  if (position && (position.x !== 0 || position.y !== 0 || position.z !== 0)) {
    const trsf = new oc.gp_Trsf_1();
    const vec = new oc.gp_Vec_4(position.x, position.y, position.z);
    trsf.SetTranslation_1(vec);
    vec.delete();
    const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    trsf.delete();
    shape = transformer.Shape();
    transformer.delete();
  }
  return shape;
}

// ─── Planar face from boundary ────────────────────────────────────

export function buildPlanarFaceFromBoundaryHelper(
  oc: OpenCascadeInstance,
  brepJson: BrepJSON,
): TopoDS_Shape | null {
  const shape = brepToOCShapeHelper(oc, brepJson);
  if (shape.IsNull()) return null;
  if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_FACE) return shape;

  const tolerance = 1e-5;
  const analyzer = new oc.ShapeAnalysis_FreeBounds_2(shape, tolerance, false, false);
  const closedWires = analyzer.GetClosedWires();
  if (closedWires.IsNull()) { analyzer.delete(); return null; }

  let outerWire: TopoDS_Wire | null = null;
  let largestArea = 0;

  const wireExplorer = new oc.TopExp_Explorer_2(
    closedWires, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (wireExplorer.More()) {
    const currentWire = oc.TopoDS.Wire_1(wireExplorer.Current());
    try {
      const tempFaceBuilder = new oc.BRepBuilderAPI_MakeFace_15(currentWire, true);
      if (tempFaceBuilder.IsDone()) {
        const tempFace = tempFaceBuilder.Face();
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.SurfaceProperties_1(tempFace, props, 1e-7, false as any);
        const area = Math.abs(props.Mass());
        if (area > largestArea) { largestArea = area; outerWire = currentWire; }
        props.delete(); tempFaceBuilder.delete();
      }
    } catch { if (!outerWire) outerWire = currentWire; }
    wireExplorer.Next();
  }
  wireExplorer.delete();
  analyzer.delete();

  if (!outerWire) return null;
  const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);
  return faceBuilder.IsDone() ? faceBuilder.Face() : null;
}

// ─── Wire from points ─────────────────────────────────────────────

export function buildWireFromPointsHelper(
  oc: OpenCascadeInstance,
  points: Vec3[],
): TopoDS_Wire | null {
  if (points.length < 2) return null;
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = new oc.gp_Pnt_3(points[i].x, points[i].y, points[i].z);
    const p2 = new oc.gp_Pnt_3(points[i + 1].x, points[i + 1].y, points[i + 1].z);
    const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    if (edgeBuilder.IsDone()) wireBuilder.Add_1(edgeBuilder.Edge());
    p1.delete(); p2.delete(); edgeBuilder.delete();
  }
  if (!wireBuilder.IsDone()) return null;
  const wire = wireBuilder.Wire();
  wireBuilder.delete();
  return wire;
}

// ─── Extrusion ────────────────────────────────────────────────────

export function extrudeShapeHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  depth: number,
  direction: number = 1,
  normalVec?: Vec3,
): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  const faces: any[] = [];
  const faceExplorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (faceExplorer.More()) {
    faces.push(oc.TopoDS.Face_1(faceExplorer.Current()));
    faceExplorer.Next();
  }
  faceExplorer.delete();
  if (faces.length === 0) { progressRange.delete(); throw new Error("No face found for extrusion"); }

  const n = normalVec || { x: 0, y: 0, z: 1 };
  const d = direction * Math.abs(depth);
  const extrusionVec = new oc.gp_Vec_4(n.x * d, n.y * d, n.z * d);

  let baseShape: any;
  if (faces.length === 1) {
    baseShape = faces[0];
  } else {
    const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const face of faces) sewing.Add(face);
    sewing.Perform(progressRange);
    baseShape = sewing.SewedShape();
  }

  const prism = new oc.BRepPrimAPI_MakePrism_1(baseShape, extrusionVec, false, true);
  prism.Build(progressRange);
  if (!prism.IsDone()) {
    let detail = "unknown reason";
    try { prism.Check(); } catch (e: any) { detail = e?.message || String(e); }
    extrusionVec.delete(); progressRange.delete();
    throw new Error(`Prism creation failed: ${detail}`);
  }

  const result = prism.Shape();
  const fixer = new oc.ShapeFix_Shape_2(result);
  fixer.SetPrecision(1e-9);
  fixer.Perform(progressRange);
  try { oc.BRepLib.OrientClosedSolid(result); } catch { /* ok */ }
  extrusionVec.delete(); progressRange.delete();
  return fixer.Shape();
}

// ─── Sweep ────────────────────────────────────────────────────────

function sweepShapeSimpleHelper(
  oc: OpenCascadeInstance,
  profileFace: TopoDS_Shape,
  pathWire: TopoDS_Wire,
): TopoDS_Shape {
  const pipe = new oc.BRepOffsetAPI_MakePipe_1(pathWire, profileFace);
  pipe.Build(new oc.Message_ProgressRange_1());
  if (!pipe.IsDone()) { pipe.delete(); throw new Error("BRepOffsetAPI_MakePipe failed"); }
  let result = pipe.Shape();
  const fixer = new oc.ShapeFix_Shape_2(result);
  fixer.Perform(new oc.Message_ProgressRange_1());
  result = fixer.Shape();
  try { oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result)); } catch { /* ok */ }
  pipe.delete(); fixer.delete();
  return result;
}

export function sweepShapeAdvancedHelper(
  oc: OpenCascadeInstance,
  profileFace: TopoDS_Shape,
  pathWire: TopoDS_Wire,
  options: { orientation: "perpendicular" | "parallel"; cornerMode: "right" | "round" },
): TopoDS_Shape {
  let pipeShell: any = null;
  try {
    const face = oc.TopoDS.Face_1(profileFace);
    const profileWire = oc.BRepTools.OuterWire(face);
    pipeShell = new oc.BRepOffsetAPI_MakePipeShell(pathWire);

    if (options.orientation === "perpendicular") {
      pipeShell.SetDiscreteMode();
    } else {
      const axOrigin = new oc.gp_Pnt_3(0, 0, 0);
      const axDir = new oc.gp_Dir_4(0, 0, 1);
      const axXDir = new oc.gp_Dir_4(1, 0, 0);
      const ax2 = new oc.gp_Ax2_3(axOrigin, axDir, axXDir);
      pipeShell.SetMode_2(ax2);
      axOrigin.delete(); axDir.delete(); axXDir.delete(); ax2.delete();
    }

    if (options.cornerMode === "right") {
      pipeShell.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner as any);
    } else {
      pipeShell.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RoundCorner as any);
    }

    pipeShell.Add_1(profileWire, false, true);
    pipeShell.Build(new oc.Message_ProgressRange_1());

    if (!pipeShell.IsDone()) {
      let reason = "unknown";
      try {
        const status = pipeShell.GetStatus();
        if (status === oc.BRepBuilderAPI_PipeError.BRepBuilderAPI_PlaneNotIntersectGuide)
          reason = "guide curve does not intersect profile plane";
        else if (status === oc.BRepBuilderAPI_PipeError.BRepBuilderAPI_ImpossibleContact)
          reason = "impossible contact between profile and path";
      } catch { /* best effort */ }
      console.warn(`[sweepShapeAdvanced] MakePipeShell failed: ${reason}, falling back to simple pipe`);
      pipeShell.delete();
      return sweepShapeSimpleHelper(oc, profileFace, pathWire);
    }

    pipeShell.MakeSolid();
    let result = pipeShell.Shape();
    const fixer = new oc.ShapeFix_Shape_2(result);
    fixer.Perform(new oc.Message_ProgressRange_1());
    result = fixer.Shape();
    try { oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result)); } catch { /* ok */ }
    pipeShell.delete(); fixer.delete();
    return result;
  } catch {
    pipeShell?.delete();
    return sweepShapeSimpleHelper(oc, profileFace, pathWire);
  }
}

// ─── Revolve ──────────────────────────────────────────────────────

export function revolveShapeHelper(
  oc: OpenCascadeInstance,
  face: TopoDS_Shape,
  axisOrigin: Vec3,
  axisDir: Vec3,
  angleRadians?: number,
): TopoDS_Shape {
  const origin = new oc.gp_Pnt_3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
  const direction = new oc.gp_Dir_4(axisDir.x, axisDir.y, axisDir.z);
  const axis = new oc.gp_Ax1_2(origin, direction);

  const isFullRevolution = angleRadians === undefined || Math.abs(angleRadians - 2 * Math.PI) < 1e-6;
  let revolBuilder: any;
  if (isFullRevolution) {
    revolBuilder = new oc.BRepPrimAPI_MakeRevol_2(face, axis, true);
  } else {
    revolBuilder = new oc.BRepPrimAPI_MakeRevol_1(face, axis, angleRadians!, true);
  }

  revolBuilder.Build(new oc.Message_ProgressRange_1());
  if (!revolBuilder.IsDone()) {
    let detail = "unknown reason";
    try { revolBuilder.Check(); } catch (e: any) { detail = e?.message || String(e); }
    origin.delete(); direction.delete(); axis.delete(); revolBuilder.delete();
    throw new Error(`Revolve failed: ${detail}`);
  }

  let result = revolBuilder.Shape();
  const fixer = new oc.ShapeFix_Shape_2(result);
  fixer.Perform(new oc.Message_ProgressRange_1());
  result = fixer.Shape();
  try { oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result)); } catch { /* ok */ }
  origin.delete(); direction.delete(); axis.delete(); revolBuilder.delete(); fixer.delete();
  return result;
}

// ─── Loft ─────────────────────────────────────────────────────────

export function loftShapesHelper(
  oc: OpenCascadeInstance,
  profileFaces: TopoDS_Shape[],
  isSolid: boolean = true,
  isRuled: boolean = false,
): TopoDS_Shape {
  const thruSections = new oc.BRepOffsetAPI_ThruSections(isSolid, isRuled, 1e-6);
  for (const face of profileFaces) {
    const explorer = new oc.TopExp_Explorer_2(
      face, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    if (explorer.More()) thruSections.AddWire(oc.TopoDS.Wire_1(explorer.Current()));
    explorer.delete();
  }
  thruSections.Build(new oc.Message_ProgressRange_1());
  if (!thruSections.IsDone()) {
    let detail = "unknown reason";
    try { thruSections.Check(); } catch (e: any) { detail = e?.message || String(e); }
    thruSections.delete();
    throw new Error(`ThruSections failed: ${detail}`);
  }
  let result = thruSections.Shape();
  const fixer = new oc.ShapeFix_Shape_2(result);
  fixer.Perform(new oc.Message_ProgressRange_1());
  result = fixer.Shape();
  try { oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result)); } catch { /* ok */ }
  thruSections.delete(); fixer.delete();
  return result;
}

// ─── Booleans ─────────────────────────────────────────────────────

function fixAndOrient(oc: OpenCascadeInstance, shape: TopoDS_Shape): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  const fixer = new oc.ShapeFix_Shape_2(shape);
  fixer.SetPrecision(1e-6);
  fixer.Perform(progressRange);
  try { oc.BRepLib.OrientClosedSolid(shape); } catch { /* ok */ }
  const result = fixer.Shape();
  progressRange.delete();
  return result;
}

function prepareBooleanOperand(oc: OpenCascadeInstance, shape: TopoDS_Shape): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  const fixer = new oc.ShapeFix_Shape_2(shape);
  fixer.SetPrecision(1e-6);
  fixer.Perform(progressRange);
  const result = fixer.Shape();
  progressRange.delete();
  return result;
}

export function booleanUnionHelper(
  oc: OpenCascadeInstance,
  shape1: TopoDS_Shape,
  shape2: TopoDS_Shape,
): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  const fixed1 = prepareBooleanOperand(oc, shape1);
  const fixed2 = prepareBooleanOperand(oc, shape2);

  const op = new oc.BRepAlgoAPI_Fuse_1();
  op.SetFuzzyValue(1e-5);
  op.SetNonDestructive(true);
  op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
  op.SetCheckInverted(true);
  const args = new oc.TopTools_ListOfShape_1(); args.Append_1(fixed1); op.SetArguments(args);
  const tools = new oc.TopTools_ListOfShape_1(); tools.Append_1(fixed2); op.SetTools(tools);
  op.Build(progressRange);
  if (!op.IsDone()) throw new Error(`Boolean union failed: ${collectBooleanDiagnostics(oc, op)}`);
  return fixAndOrient(oc, op.Shape());
}

export function booleanDifferenceHelper(
  oc: OpenCascadeInstance,
  baseShape: TopoDS_Shape,
  toolShape: TopoDS_Shape,
): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  const fixedBase = prepareBooleanOperand(oc, baseShape);
  const fixedTool = prepareBooleanOperand(oc, toolShape);

  const op = new oc.BRepAlgoAPI_Cut_1();
  op.SetFuzzyValue(1e-5);
  op.SetNonDestructive(true);
  op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
  op.SetCheckInverted(true);
  const args = new oc.TopTools_ListOfShape_1(); args.Append_1(fixedBase); op.SetArguments(args);
  const tools = new oc.TopTools_ListOfShape_1(); tools.Append_1(fixedTool); op.SetTools(tools);
  op.Build(progressRange);
  if (!op.IsDone()) throw new Error(`Boolean difference failed: ${collectBooleanDiagnostics(oc, op)}`);
  return fixAndOrient(oc, op.Shape());
}

export function booleanIntersectionHelper(
  oc: OpenCascadeInstance,
  shape1: TopoDS_Shape,
  shape2: TopoDS_Shape,
): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  const fixed1 = prepareBooleanOperand(oc, shape1);
  const fixed2 = prepareBooleanOperand(oc, shape2);

  const op = new oc.BRepAlgoAPI_Common_1();
  op.SetFuzzyValue(1e-5);
  op.SetNonDestructive(true);
  op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
  op.SetCheckInverted(true);
  const args = new oc.TopTools_ListOfShape_1(); args.Append_1(fixed1); op.SetArguments(args);
  const tools = new oc.TopTools_ListOfShape_1(); tools.Append_1(fixed2); op.SetTools(tools);
  op.Build(progressRange);
  if (!op.IsDone()) throw new Error(`Boolean intersection failed: ${collectBooleanDiagnostics(oc, op)}`);
  return fixAndOrient(oc, op.Shape());
}

// ─── Fillet / Chamfer ─────────────────────────────────────────────

export function filletEdgesHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edgeIndices: number[],
  radius: number,
  skipFix: boolean = false,
): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  let fixedShape: TopoDS_Shape;
  if (skipFix) { fixedShape = shape; }
  else {
    const fixer = new oc.ShapeFix_Shape_2(shape);
    fixer.SetPrecision(1e-6); fixer.Perform(progressRange);
    fixedShape = fixer.Shape();
  }
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(fixedShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  const fillet = new oc.BRepFilletAPI_MakeFillet(fixedShape, oc.ChFi3d_FilletShape.ChFi3d_Rational as any);
  for (const idx of edgeIndices) {
    if (idx >= 1 && idx <= edgeMap.Size()) {
      fillet.Add_2(radius, oc.TopoDS.Edge_1(edgeMap.FindKey(idx)));
    }
  }
  fillet.Build(progressRange);
  if (!fillet.IsDone()) {
    const detail = collectFilletDiagnostics(oc, fillet);
    throw new Error(detail);
  }
  return fixAndOrient(oc, fillet.Shape());
}

export function chamferEdgesHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edgeIndices: number[],
  distance: number,
  skipFix: boolean = false,
): TopoDS_Shape {
  const progressRange = new oc.Message_ProgressRange_1();
  let fixedShape: TopoDS_Shape;
  if (skipFix) { fixedShape = shape; }
  else {
    const fixer = new oc.ShapeFix_Shape_2(shape);
    fixer.SetPrecision(1e-6); fixer.Perform(progressRange);
    fixedShape = fixer.Shape();
  }
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(fixedShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  const chamfer = new oc.BRepFilletAPI_MakeChamfer(fixedShape);
  for (const idx of edgeIndices) {
    if (idx >= 1 && idx <= edgeMap.Size()) {
      chamfer.Add_2(distance, oc.TopoDS.Edge_1(edgeMap.FindKey(idx)));
    }
  }
  chamfer.Build(progressRange);
  if (!chamfer.IsDone()) {
    const detail = collectChamferDiagnostics(oc, chamfer);
    throw new Error(detail);
  }
  return fixAndOrient(oc, chamfer.Shape());
}

// ─── Wire diagnostics ─────────────────────────────────────────────

function wireErrorToString(oc: OpenCascadeInstance, wire: any): string {
  try {
    const err = wire.Error();
    if (err === oc.BRepBuilderAPI_WireError.BRepBuilderAPI_EmptyWire) return "no edges in wire";
    if (err === oc.BRepBuilderAPI_WireError.BRepBuilderAPI_DisconnectedWire) return "edges are disconnected";
    if (err === oc.BRepBuilderAPI_WireError.BRepBuilderAPI_NonManifoldWire) return "non-manifold wire";
  } catch { /* best effort */ }
  return "unknown reason";
}

// ─── Boolean diagnostics ──────────────────────────────────────────

function collectBooleanDiagnostics(oc: OpenCascadeInstance, op: any): string {
  const parts: string[] = [];
  try { if (op.HasErrors()) parts.push("shape computation error"); } catch { /* best effort */ }
  try { if (op.HasWarnings()) parts.push("with warnings"); } catch { /* best effort */ }
  return parts.length > 0 ? parts.join(", ") : "unknown reason";
}

// ─── Fillet/Chamfer diagnostics ───────────────────────────────────

function statusToString(oc: OpenCascadeInstance, status: any): string {
  if (status === oc.ChFiDS_ErrorStatus.ChFiDS_WalkingFailure) return "radius too large for edge geometry";
  if (status === oc.ChFiDS_ErrorStatus.ChFiDS_StartsolFailure) return "cannot compute fillet at this edge";
  if (status === oc.ChFiDS_ErrorStatus.ChFiDS_TwistedSurface) return "fillet surface would self-intersect";
  if (status === oc.ChFiDS_ErrorStatus.ChFiDS_Error) return "computation error";
  return "unknown status";
}

function collectFilletDiagnostics(oc: OpenCascadeInstance, fillet: any): string {
  const parts: string[] = [];
  try {
    const nFaulty = fillet.NbFaultyContours();
    if (nFaulty > 0) {
      for (let i = 1; i <= nFaulty; i++) {
        const ic = fillet.FaultyContour(i);
        try {
          const status = fillet.StripeStatus(ic);
          const name = statusToString(oc, status);
          parts.push(name);
        } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ }
  try {
    const nVerts = fillet.NbFaultyVertices();
    if (nVerts > 0) parts.push(`${nVerts} faulty vertex(es)`);
  } catch { /* best effort */ }
  return parts.length > 0 ? parts.join(", ") : "unknown reason";
}

function collectChamferDiagnostics(oc: OpenCascadeInstance, chamfer: any): string {
  const parts: string[] = [];
  try {
    const nFaulty = chamfer.NbFaultyContours();
    if (nFaulty > 0) {
      for (let i = 1; i <= nFaulty; i++) {
        const ic = chamfer.FaultyContour(i);
        try {
          const status = chamfer.StripeStatus(ic);
          const name = statusToString(oc, status);
          parts.push(name);
        } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ }
  try {
    const nVerts = chamfer.NbFaultyVertices();
    if (nVerts > 0) parts.push(`${nVerts} faulty vertex(es)`);
  } catch { /* best effort */ }
  return parts.length > 0 ? parts.join(", ") : "unknown reason";
}

// ─── Edge analysis ────────────────────────────────────────────────

function getSharpEdgeIndicesHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edgeMap: any,
  count: number,
): Set<number> {
  const sharpIndices = new Set<number>();
  const edgeFaceMap = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
  oc.TopExp.MapShapesAndAncestors(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_FACE, edgeFaceMap);

  for (let i = 1; i <= count; i++) {
    try {
      const edgeShape = edgeMap.FindKey(i);
      const edge = oc.TopoDS.Edge_1(edgeShape);
      if (oc.BRep_Tool.Degenerated(edge)) continue;
      const adjIdx = edgeFaceMap.FindIndex(edgeShape);
      if (adjIdx === 0) continue;
      const faceList = edgeFaceMap.FindFromIndex(adjIdx);
      if (faceList.Size() !== 2) continue;
      const face1 = oc.TopoDS.Face_1(faceList.First_1());
      if (oc.BRep_Tool.IsClosed_2(edge, face1)) continue;
      const face2 = oc.TopoDS.Face_1(faceList.Last_1());
      const continuity = oc.BRep_Tool.Continuity_1(edge, face1, face2);
      if (continuity !== oc.GeomAbs_Shape.GeomAbs_C0) continue;
      sharpIndices.add(i);
    } catch { continue; }
  }
  edgeFaceMap.delete();
  return sharpIndices;
}

export function getEdgeLineSegmentsPerEdgeHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  linearDeflection: number = 0.003,
  skipFix: boolean = false,
  allEdges: boolean = false,
): Array<{ edgeIndex: number; segments: Float32Array; midpoint: Vec3 }> {
  let fixedShape: TopoDS_Shape;
  if (skipFix) { fixedShape = shape; }
  else {
    const progressRange = new oc.Message_ProgressRange_1();
    const fixer = new oc.ShapeFix_Shape_2(shape);
    fixer.SetPrecision(1e-6); fixer.Perform(progressRange);
    fixedShape = fixer.Shape();
  }
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(fixedShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  const count = edgeMap.Size();
  const sharpIndices = allEdges ? null : getSharpEdgeIndicesHelper(oc, fixedShape, edgeMap, count);
  const result: Array<{ edgeIndex: number; segments: Float32Array; midpoint: Vec3 }> = [];

  for (let i = 1; i <= count; i++) {
    if (sharpIndices && !sharpIndices.has(i)) continue;
    const edgeShape = edgeMap.FindKey(i);
    const edge = oc.TopoDS.Edge_1(edgeShape);
    if (oc.BRep_Tool.Degenerated(edge)) continue;
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const curveType = curve.GetType();
    const first = curve.FirstParameter();
    const last = curve.LastParameter();
    const positions: number[] = [];

    if (curveType === oc.GeomAbs_CurveType.GeomAbs_Line) {
      const p1 = curve.Value(first); const p2 = curve.Value(last);
      positions.push(p1.X(), p1.Y(), p1.Z()); positions.push(p2.X(), p2.Y(), p2.Z());
    } else {
      const gcpu = new oc.GCPnts_UniformDeflection_4(curve, linearDeflection, first, last, false);
      if (gcpu.IsDone()) {
        const nbPoints = gcpu.NbPoints();
        for (let j = 1; j < nbPoints; j++) {
          const p1 = gcpu.Value(j); const p2 = gcpu.Value(j + 1);
          positions.push(p1.X(), p1.Y(), p1.Z()); positions.push(p2.X(), p2.Y(), p2.Z());
        }
      } else {
        const numSegments = 32; const step = (last - first) / numSegments;
        for (let j = 0; j < numSegments; j++) {
          const p1 = curve.Value(first + j * step); const p2 = curve.Value(first + (j + 1) * step);
          positions.push(p1.X(), p1.Y(), p1.Z()); positions.push(p2.X(), p2.Y(), p2.Z());
        }
      }
    }
    const midPt = curve.Value((first + last) / 2);
    result.push({ edgeIndex: i, segments: new Float32Array(positions), midpoint: { x: midPt.X(), y: midPt.Y(), z: midPt.Z() } });
  }
  return result;
}

// ─── Raw geometry extraction (no THREE.js) ────────────────────────

/**
 * Tessellate shape and return raw positions + indices + normals.
 */
export function shapeToRawGeometry(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  linearDeflection: number = 0.003,
  angularDeflection: number = 0.1,
): { positions: Float32Array; indices: Uint32Array; normals: Float32Array } {
  try { oc.BRepTools.Clean(shape, true); } catch { /* ignore */ }
  new oc.BRepMesh_IncrementalMesh_2(shape, linearDeflection, false, angularDeflection, false);

  const vertices: number[] = [];
  const indices: number[] = [];
  let indexOffset = 0;

  const faceExplorer = new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);
    if (!triangulation.IsNull()) {
      const transformation = location.Transformation();
      const nbNodes = triangulation.get().NbNodes();
      const nbTriangles = triangulation.get().NbTriangles();
      const isReversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      for (let i = 1; i <= nbNodes; i++) {
        const node = triangulation.get().Node(i).Transformed(transformation);
        vertices.push(node.X(), node.Y(), node.Z());
      }
      for (let i = 1; i <= nbTriangles; i++) {
        const triangle = triangulation.get().Triangle(i);
        let n1 = triangle.Value(1) - 1 + indexOffset;
        let n2 = triangle.Value(2) - 1 + indexOffset;
        let n3 = triangle.Value(3) - 1 + indexOffset;
        if (isReversed) indices.push(n1, n3, n2);
        else indices.push(n1, n2, n3);
      }
      indexOffset += nbNodes;
    }
    faceExplorer.Next();
  }

  const positionsArr = new Float32Array(vertices);
  const indicesArr = new Uint32Array(indices);

  // Compute normals
  const normals = new Float32Array(vertices.length);
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indicesArr[i] * 3, i1 = indicesArr[i + 1] * 3, i2 = indicesArr[i + 2] * 3;
    const ax = positionsArr[i1] - positionsArr[i0], ay = positionsArr[i1 + 1] - positionsArr[i0 + 1], az = positionsArr[i1 + 2] - positionsArr[i0 + 2];
    const bx = positionsArr[i2] - positionsArr[i0], by = positionsArr[i2 + 1] - positionsArr[i0 + 1], bz = positionsArr[i2 + 2] - positionsArr[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }
  // Normalize
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
    if (len > 0) { normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len; }
  }

  return { positions: positionsArr, indices: indicesArr, normals };
}

/**
 * Extract sharp (or all) edge line segments as a flat Float32Array.
 */
export function shapeToRawEdgeSegments(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  linearDeflection: number = 0.003,
  allEdges: boolean = false,
): Float32Array {
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  const count = edgeMap.Size();
  const sharpIndices = allEdges ? null : getSharpEdgeIndicesHelper(oc, shape, edgeMap, count);
  const positions: number[] = [];

  for (let i = 1; i <= count; i++) {
    if (sharpIndices && !sharpIndices.has(i)) continue;
    const edge = oc.TopoDS.Edge_1(edgeMap.FindKey(i));
    if (!sharpIndices && oc.BRep_Tool.Degenerated(edge)) continue;
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const curveType = curve.GetType();
    const first = curve.FirstParameter();
    const last = curve.LastParameter();

    if (curveType === oc.GeomAbs_CurveType.GeomAbs_Line) {
      const p1 = curve.Value(first); const p2 = curve.Value(last);
      positions.push(p1.X(), p1.Y(), p1.Z()); positions.push(p2.X(), p2.Y(), p2.Z());
    } else {
      const gcpu = new oc.GCPnts_UniformDeflection_4(curve, linearDeflection, first, last, false);
      if (gcpu.IsDone()) {
        const nbPoints = gcpu.NbPoints();
        for (let j = 1; j < nbPoints; j++) {
          const p1 = gcpu.Value(j); const p2 = gcpu.Value(j + 1);
          positions.push(p1.X(), p1.Y(), p1.Z()); positions.push(p2.X(), p2.Y(), p2.Z());
        }
      } else {
        const numSegments = 32; const step = (last - first) / numSegments;
        for (let j = 0; j < numSegments; j++) {
          const p1 = curve.Value(first + j * step); const p2 = curve.Value(first + (j + 1) * step);
          positions.push(p1.X(), p1.Y(), p1.Z()); positions.push(p2.X(), p2.Y(), p2.Z());
        }
      }
    }
  }
  return new Float32Array(positions);
}

/**
 * Extract vertex positions at sharp edge junctions.
 */
export function shapeToVertexPositionsHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  allEdges: boolean = false,
): Float32Array {
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  const count = edgeMap.Size();
  const sharpIndices = allEdges ? null : getSharpEdgeIndicesHelper(oc, shape, edgeMap, count);

  const vertexEdgeSet = new Map<string, { x: number; y: number; z: number; edges: Set<number> }>();
  const toKey = (x: number, y: number, z: number) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;

  const edgeIndices = sharpIndices ? sharpIndices : Array.from({ length: count }, (_, k) => k + 1);
  for (const i of edgeIndices) {
    const edgeShape = edgeMap.FindKey(i);
    const edge = oc.TopoDS.Edge_1(edgeShape);
    if (!sharpIndices && oc.BRep_Tool.Degenerated(edge)) continue;
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const p1 = curve.Value(curve.FirstParameter());
    const p2 = curve.Value(curve.LastParameter());
    for (const pt of [{ x: p1.X(), y: p1.Y(), z: p1.Z() }, { x: p2.X(), y: p2.Y(), z: p2.Z() }]) {
      const key = toKey(pt.x, pt.y, pt.z);
      const existing = vertexEdgeSet.get(key);
      if (existing) existing.edges.add(i);
      else vertexEdgeSet.set(key, { ...pt, edges: new Set([i]) });
    }
  }

  const positions: number[] = [];
  for (const [, info] of vertexEdgeSet) {
    if (info.edges.size >= 2) positions.push(info.x, info.y, info.z);
  }
  return new Float32Array(positions);
}

// ─── Bounding box center ─────────────────────────────────────────

export function computeBoundingBoxCenter(oc: OpenCascadeInstance, shape: TopoDS_Shape): Vec3 {
  const bBox = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape, bBox, false);
  const result = {
    x: (bBox.CornerMin().X() + bBox.CornerMax().X()) / 2,
    y: (bBox.CornerMin().Y() + bBox.CornerMax().Y()) / 2,
    z: (bBox.CornerMin().Z() + bBox.CornerMax().Z()) / 2,
  };
  bBox.delete();
  return result;
}

// ─── Translation helper ──────────────────────────────────────────

export function translateShape(oc: OpenCascadeInstance, shape: TopoDS_Shape, vec: Vec3): TopoDS_Shape {
  const trsf = new oc.gp_Trsf_1();
  const gVec = new oc.gp_Vec_4(vec.x, vec.y, vec.z);
  trsf.SetTranslation_1(gVec);
  gVec.delete();
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  trsf.delete();
  const result = transformer.Shape();
  transformer.delete();
  return result;
}

// ─── Sketch helpers ───────────────────────────────────────────────

export function buildSketchEdgesHelper(
  oc: OpenCascadeInstance,
  primitives: SketchPrimitive[],
  pointMap: Map<string, { x: number; y: number }>,
): { circleEdges: TopoDS_Edge[]; otherEdges: TopoDS_Edge[] } {
  const circleEdges: TopoDS_Edge[] = [];
  const otherEdges: TopoDS_Edge[] = [];

  for (const prim of primitives) {
    if (prim.type === "circle") {
      const circle = prim as SketchCircle;
      const center = pointMap.get(circle.centerId);
      if (!center) continue;
      const gpCenter = new oc.gp_Pnt_3(center.x, center.y, 0);
      const dir = new oc.gp_Dir_4(0, 0, 1);
      const axis = new oc.gp_Ax2_3(gpCenter, dir);
      const gpCircle = new oc.gp_Circ_2(axis, circle.radius);
      const builder = new oc.BRepBuilderAPI_MakeEdge_8(gpCircle);
      if (builder.IsDone()) circleEdges.push(builder.Edge());
      gpCenter.delete(); dir.delete(); axis.delete(); gpCircle.delete(); builder.delete();
    } else if (prim.type === "line") {
      const line = prim as SketchLine;
      const p1 = pointMap.get(line.p1Id);
      const p2 = pointMap.get(line.p2Id);
      if (!p1 || !p2) continue;
      const gp1 = new oc.gp_Pnt_3(p1.x, p1.y, 0);
      const gp2 = new oc.gp_Pnt_3(p2.x, p2.y, 0);
      const builder = new oc.BRepBuilderAPI_MakeEdge_3(gp1, gp2);
      if (builder.IsDone()) otherEdges.push(builder.Edge());
      gp1.delete(); gp2.delete(); builder.delete();
    } else if (prim.type === "arc") {
      const arc = prim as SketchArc;
      const center = pointMap.get(arc.centerId);
      const start = pointMap.get(arc.startId);
      const end = pointMap.get(arc.endId);
      if (!center || !start || !end) continue;
      const radius = Math.sqrt((start.x - center.x) ** 2 + (start.y - center.y) ** 2);
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      const gpCenter = new oc.gp_Pnt_3(center.x, center.y, 0);
      const dir = new oc.gp_Dir_4(0, 0, 1);
      const axis = new oc.gp_Ax2_3(gpCenter, dir);
      const circle = new oc.gp_Circ_2(axis, radius);
      const builder = new oc.BRepBuilderAPI_MakeEdge_9(circle, startAngle, endAngle);
      if (builder.IsDone()) otherEdges.push(builder.Edge());
      gpCenter.delete(); dir.delete(); axis.delete(); circle.delete(); builder.delete();
    }
  }
  return { circleEdges, otherEdges };
}

export function buildSketchPointMap(primitives: SketchPrimitive[]): Map<string, { x: number; y: number }> {
  const pointMap = new Map<string, { x: number; y: number }>();
  for (const prim of primitives) {
    if (prim.type === "point") {
      pointMap.set(prim.id, { x: (prim as any).x, y: (prim as any).y });
    }
  }
  return pointMap;
}

export function transformShapeToPlaneHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  plane: SketchPlane,
): TopoDS_Shape {
  const isIdentity = plane.type === "XY"
    && Math.abs(plane.origin.x) < 1e-9
    && Math.abs(plane.origin.y) < 1e-9
    && Math.abs(plane.origin.z) < 1e-9;
  if (isIdentity) return shape;

  const trsf = new oc.gp_Trsf_1();
  trsf.SetValues(
    plane.xAxis.x, plane.yAxis.x, plane.normal.x, plane.origin.x,
    plane.xAxis.y, plane.yAxis.y, plane.normal.y, plane.origin.y,
    plane.xAxis.z, plane.yAxis.z, plane.normal.z, plane.origin.z,
  );
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  trsf.delete();
  if (transformer.IsDone()) {
    const result = transformer.Shape();
    transformer.delete();
    return result;
  }
  transformer.delete();
  return shape;
}

export function detectProfileRegionsHelper(
  oc: OpenCascadeInstance,
  edges: TopoDS_Edge[],
): TopoDS_Face[] {
  if (edges.length < 1) return [];
  const builder = new oc.BRep_Builder();
  const edgeCompound = new oc.TopoDS_Compound();
  builder.MakeCompound(edgeCompound);
  for (const edge of edges) builder.Add(edgeCompound, edge);

  const wireCompound = new oc.TopoDS_Compound();
  builder.MakeCompound(wireCompound);
  const wireResult = oc.BOPAlgo_Tools.EdgesToWires(edgeCompound, wireCompound, false, 1e-8);
  if (wireResult !== 0) return [];

  const faceCompound = new oc.TopoDS_Compound();
  builder.MakeCompound(faceCompound);
  const success = oc.BOPAlgo_Tools.WiresToFaces(wireCompound, faceCompound, 1e-8);
  if (!success) return [];

  const faces: TopoDS_Face[] = [];
  const faceExplorer = new oc.TopExp_Explorer_2(
    faceCompound, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (faceExplorer.More()) {
    faces.push(oc.TopoDS.Face_1(faceExplorer.Current()));
    faceExplorer.Next();
  }
  faceExplorer.delete();
  return faces;
}

// ─── Import / Export ──────────────────────────────────────────────

export function readSTEPHelper(oc: OpenCascadeInstance, fileBytes: Uint8Array): TopoDS_Shape[] {
  const filePath = "/tmp/import.step";
  oc.FS.writeFile(filePath, fileBytes);
  const reader = new oc.STEPControl_Reader_1();
  const readStatus = reader.ReadFile(filePath);
  if (readStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    reader.delete(); oc.FS.unlink(filePath);
    throw new Error("STEP import: ReadFile failed");
  }
  const progress = new oc.Message_ProgressRange_1();
  reader.TransferRoots(progress);
  const shapes: TopoDS_Shape[] = [];
  const nbShapes = reader.NbShapes();
  if (nbShapes === 1) shapes.push(reader.OneShape());
  else for (let i = 1; i <= nbShapes; i++) shapes.push(reader.Shape(i));
  reader.delete(); progress.delete(); oc.FS.unlink(filePath);
  return shapes;
}

export function writeSTEPHelper(oc: OpenCascadeInstance, compound: TopoDS_Shape): Uint8Array {
  const filePath = "/tmp/export.step";
  const writer = new oc.STEPControl_Writer_1();
  const progress = new oc.Message_ProgressRange_1();
  const transferStatus = writer.Transfer(compound, oc.STEPControl_StepModelType.STEPControl_AsIs as any, true, progress);
  if (transferStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    writer.delete(); progress.delete(); throw new Error("STEP export: Transfer failed");
  }
  const writeStatus = writer.Write(filePath);
  if (writeStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    writer.delete(); progress.delete(); throw new Error("STEP export: Write failed");
  }
  const fileData = oc.FS.readFile(filePath);
  oc.FS.unlink(filePath); writer.delete(); progress.delete();
  return new Uint8Array(fileData);
}

export function readSTLHelper(oc: OpenCascadeInstance, fileBytes: Uint8Array): TopoDS_Shape {
  const filePath = "/tmp/import.stl";
  oc.FS.writeFile(filePath, fileBytes);
  const reader = new oc.StlAPI_Reader();
  const shape = new oc.TopoDS_Shape();
  const success = reader.Read(shape, filePath);
  if (!success) { reader.delete(); shape.delete(); oc.FS.unlink(filePath); throw new Error("STL import failed"); }
  reader.delete(); oc.FS.unlink(filePath);
  return shape;
}

export function writeSTLHelper(oc: OpenCascadeInstance, compound: TopoDS_Shape): Uint8Array {
  const filePath = "/tmp/export.stl";
  new oc.BRepMesh_IncrementalMesh_2(compound, 0.01, false, 0.1, false);
  const writer = new oc.StlAPI_Writer();
  const progress = new oc.Message_ProgressRange_1();
  const success = writer.Write(compound, filePath, progress);
  if (!success) { writer.delete(); progress.delete(); throw new Error("STL export failed"); }
  const fileData = oc.FS.readFile(filePath);
  oc.FS.unlink(filePath); writer.delete(); progress.delete();
  return new Uint8Array(fileData);
}

export function writeIGESHelper(oc: OpenCascadeInstance, compound: TopoDS_Shape): Uint8Array {
  const filePath = "/tmp/export.iges";
  const writer = new oc.IGESControl_Writer_1();
  const progress = new oc.Message_ProgressRange_1();
  writer.AddShape(compound, progress);
  writer.ComputeModel();
  writer.Write_2(filePath, false);
  const fileData = oc.FS.readFile(filePath);
  oc.FS.unlink(filePath); writer.delete(); progress.delete();
  return new Uint8Array(fileData);
}

// ─── Face area ────────────────────────────────────────────────────

export function calculateFaceAreaHelper(oc: OpenCascadeInstance, face: TopoDS_Face): number {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false as any);
  const mass = props.Mass();
  props.delete();
  return mass;
}

// ─── Face to BRep JSON ────────────────────────────────────────────

export function faceToBrepWithCenterHelper(
  oc: OpenCascadeInstance,
  face: TopoDS_Face,
): { brepJson: BrepJSON; center: Vec3 } {
  // Mesh the face
  new oc.BRepMesh_IncrementalMesh_2(face, 0.01, false, 0.1, true);
  const location = new oc.TopLoc_Location_1();
  const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

  if (triangulation.IsNull()) {
    return { brepJson: { vertices: [], edges: [], faces: [] }, center: { x: 0, y: 0, z: 0 } };
  }

  const vertexMap = new Map<string, VertexJSON>();
  const allVertices: VertexJSON[] = [];
  const jsonFaces: { vertices: VertexJSON[] }[] = [];

  const transformation = location.Transformation();
  const nbTriangles = triangulation.get().NbTriangles();
  const isReversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

  for (let i = 1; i <= nbTriangles; i++) {
    const triangle = triangulation.get().Triangle(i);
    const p1 = triangulation.get().Node(triangle.Value(1)).Transformed(transformation);
    const p2 = triangulation.get().Node(triangle.Value(2)).Transformed(transformation);
    const p3 = triangulation.get().Node(triangle.Value(3)).Transformed(transformation);
    const v1 = getOrCreateVertexHelper(vertexMap, p1.X(), p1.Y(), p1.Z(), allVertices);
    const v2 = getOrCreateVertexHelper(vertexMap, p2.X(), p2.Y(), p2.Z(), allVertices);
    const v3 = getOrCreateVertexHelper(vertexMap, p3.X(), p3.Y(), p3.Z(), allVertices);
    if (isReversed) jsonFaces.push({ vertices: [v1, v3, v2] });
    else jsonFaces.push({ vertices: [v1, v2, v3] });
  }

  const absoluteBrepJson: BrepJSON = { vertices: allVertices, edges: [], faces: jsonFaces };
  if (allVertices.length === 0) {
    return { brepJson: absoluteBrepJson, center: { x: 0, y: 0, z: 0 } };
  }

  const bounds = calculateBrepBoundsFromJSON(absoluteBrepJson);
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };

  // Center at origin
  for (const v of allVertices) {
    v.x -= center.x; v.y -= center.y; v.z -= center.z;
  }

  return { brepJson: absoluteBrepJson, center };
}

// ─── Edge length measurement ──────────────────────────────────────

export function getEdgeLengthHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edgeIndex: number,
  skipFix: boolean = false,
): number {
  const progressRange = new oc.Message_ProgressRange_1();
  let fixedShape: TopoDS_Shape;
  if (skipFix) {
    fixedShape = shape;
  } else {
    const fixer = new oc.ShapeFix_Shape_2(shape);
    fixer.SetPrecision(1e-6);
    fixer.Perform(progressRange);
    fixedShape = fixer.Shape();
  }

  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(fixedShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  const count = edgeMap.Size();

  if (edgeIndex < 1 || edgeIndex > count) {
    edgeMap.delete();
    throw new Error(`getEdgeLengthHelper: edgeIndex ${edgeIndex} out of range [1, ${count}]`);
  }

  const edgeShape = edgeMap.FindKey(edgeIndex);
  const edge = oc.TopoDS.Edge_1(edgeShape);

  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.LinearProperties(edge, props, false, false);
  const length = props.Mass();

  props.delete();
  edgeMap.delete();
  return length;
}

// ─── Edge direction at midpoint ───────────────────────────────────

export function getEdgeDirectionAtMidpointHelper(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edgeIndex: number,
  skipFix: boolean = false,
): { x: number; y: number; z: number } {
  const progressRange = new oc.Message_ProgressRange_1();
  let fixedShape: TopoDS_Shape;
  if (skipFix) {
    fixedShape = shape;
  } else {
    const fixer = new oc.ShapeFix_Shape_2(shape);
    fixer.SetPrecision(1e-6);
    fixer.Perform(progressRange);
    fixedShape = fixer.Shape();
  }

  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(fixedShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  const count = edgeMap.Size();

  if (edgeIndex < 1 || edgeIndex > count) {
    edgeMap.delete();
    throw new Error(`getEdgeDirectionAtMidpointHelper: edgeIndex ${edgeIndex} out of range [1, ${count}]`);
  }

  const edgeShape = edgeMap.FindKey(edgeIndex);
  const edge = oc.TopoDS.Edge_1(edgeShape);
  const curve = new oc.BRepAdaptor_Curve_2(edge);

  const first = curve.FirstParameter();
  const last = curve.LastParameter();
  const midParam = (first + last) / 2;

  const tangent = curve.DN(midParam, 1);
  const mag = tangent.Magnitude();

  let result: { x: number; y: number; z: number };
  if (mag < 1e-12) {
    const p1 = curve.Value(first);
    const p2 = curve.Value(last);
    const dx = p2.X() - p1.X();
    const dy = p2.Y() - p1.Y();
    const dz = p2.Z() - p1.Z();
    const chordLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (chordLen < 1e-12) {
      result = { x: 0, y: 0, z: 1 };
    } else {
      result = { x: dx / chordLen, y: dy / chordLen, z: dz / chordLen };
    }
    p1.delete();
    p2.delete();
  } else {
    const normalized = tangent.Normalized();
    result = { x: normalized.X(), y: normalized.Y(), z: normalized.Z() };
    normalized.delete();
  }

  tangent.delete();
  curve.delete();
  edgeMap.delete();
  return result;
}

// ─── Sketch to wire (for sweep path) ─────────────────────────────

export function sketchToWireHelper(
  oc: OpenCascadeInstance,
  primitives: SketchPrimitive[],
  plane: SketchPlane,
): { points: { x: number; y: number; z: number }[] } | null {
  const pointMap = buildSketchPointMap(primitives);

  const nonConstructionPrimitives = primitives.filter(
    (p: any) => !p.construction
  );

  // Validate
  const EPSILON = 1e-6;
  for (const prim of nonConstructionPrimitives) {
    if (prim.type === "circle") {
      if ((prim as any).radius <= EPSILON) return null;
    } else if (prim.type === "line") {
      const line = prim as SketchLine;
      const p1 = pointMap.get(line.p1Id);
      const p2 = pointMap.get(line.p2Id);
      if (p1 && p2 && Math.hypot(p2.x - p1.x, p2.y - p1.y) < EPSILON) return null;
    } else if (prim.type === "arc") {
      if ((prim as any).radius <= EPSILON) return null;
    }
  }

  // Build edges (only line/arc — circles are self-closing and not valid for wire paths)
  const edges: any[] = [];
  for (const prim of nonConstructionPrimitives) {
    if (prim.type === "line") {
      const line = prim as SketchLine;
      const p1 = pointMap.get(line.p1Id);
      const p2 = pointMap.get(line.p2Id);
      if (!p1 || !p2) continue;
      const gp1 = new oc.gp_Pnt_3(p1.x, p1.y, 0);
      const gp2 = new oc.gp_Pnt_3(p2.x, p2.y, 0);
      const builder = new oc.BRepBuilderAPI_MakeEdge_3(gp1, gp2);
      if (builder.IsDone()) edges.push(builder.Edge());
      gp1.delete(); gp2.delete(); builder.delete();
    } else if (prim.type === "arc") {
      const arc = prim as SketchArc;
      const center = pointMap.get(arc.centerId);
      const start = pointMap.get(arc.startId);
      const end = pointMap.get(arc.endId);
      if (!center || !start || !end) continue;
      const radius = Math.sqrt((start.x - center.x) ** 2 + (start.y - center.y) ** 2);
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      const gpCenter = new oc.gp_Pnt_3(center.x, center.y, 0);
      const dir = new oc.gp_Dir_4(0, 0, 1);
      const axis = new oc.gp_Ax2_3(gpCenter, dir);
      const circle = new oc.gp_Circ_2(axis, radius);
      const builder = new oc.BRepBuilderAPI_MakeEdge_9(circle, startAngle, endAngle);
      if (builder.IsDone()) edges.push(builder.Edge());
      gpCenter.delete(); dir.delete(); axis.delete(); circle.delete(); builder.delete();
    }
  }

  if (edges.length === 0) return null;

  // Sort edges into connected chain
  const getEndpoints = (edge: any): { start: [number, number, number]; end: [number, number, number] } | null => {
    const explorer = new oc.TopExp_Explorer_2(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const vertices: [number, number, number][] = [];
    while (explorer.More()) {
      const vertex = oc.TopoDS.Vertex_1(explorer.Current());
      const pnt = oc.BRep_Tool.Pnt(vertex);
      vertices.push([pnt.X(), pnt.Y(), pnt.Z()]);
      pnt.delete();
      explorer.Next();
    }
    explorer.delete();
    return vertices.length >= 2 ? { start: vertices[0], end: vertices[1] } : null;
  };

  const ptEq = (a: [number, number, number], b: [number, number, number], tol = 1e-3) =>
    Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol && Math.abs(a[2] - b[2]) < tol;

  // Chain edges
  const sorted: any[] = [edges[0]];
  const used = new Set<number>([0]);
  const firstEndpoints = getEndpoints(edges[0]);
  if (!firstEndpoints) return null;
  let currentEnd = firstEndpoints.end;

  while (sorted.length < edges.length) {
    let found = false;
    for (let i = 0; i < edges.length; i++) {
      if (used.has(i)) continue;
      const ep = getEndpoints(edges[i]);
      if (!ep) continue;
      if (ptEq(currentEnd, ep.start)) {
        sorted.push(edges[i]); used.add(i); currentEnd = ep.end; found = true; break;
      }
      if (ptEq(currentEnd, ep.end)) {
        sorted.push(edges[i]); used.add(i); currentEnd = ep.start; found = true; break;
      }
    }
    if (!found) break;
  }

  // Build wire
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
  for (const edge of sorted) wireBuilder.Add_1(edge);
  if (!wireBuilder.IsDone()) { wireBuilder.delete(); return null; }
  let wire = wireBuilder.Wire();
  wireBuilder.delete();

  // Extract ordered points from sorted edges
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const ep = getEndpoints(sorted[i]);
    if (ep) {
      if (i === 0) points.push({ x: ep.start[0], y: ep.start[1], z: ep.start[2] });
      points.push({ x: ep.end[0], y: ep.end[1], z: ep.end[2] });
    }
  }

  // Transform wire to sketch plane
  const transformedWire = transformShapeToPlaneHelper(oc, wire, plane);

  // Transform points to sketch plane
  const isIdentity = plane.type === "XY"
    && Math.abs(plane.origin.x) < 1e-9
    && Math.abs(plane.origin.y) < 1e-9
    && Math.abs(plane.origin.z) < 1e-9;
  const transformedPoints = isIdentity ? points : points.map(p => ({
    x: plane.origin.x + p.x * plane.xAxis.x + p.y * plane.yAxis.x + p.z * plane.normal.x,
    y: plane.origin.y + p.x * plane.xAxis.y + p.y * plane.yAxis.y + p.z * plane.normal.y,
    z: plane.origin.z + p.x * plane.xAxis.z + p.y * plane.yAxis.z + p.z * plane.normal.z,
  }));

  return { points: transformedPoints };
}
