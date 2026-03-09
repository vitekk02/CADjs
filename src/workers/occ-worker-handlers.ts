/**
 * Worker handler functions — one per operation pipeline.
 * Imports shared helpers from occ-helpers.ts.
 * Returns plain objects with typed arrays (no THREE.js).
 */

import type { OpenCascadeInstance } from "opencascade.js";
import type { BrepJSON } from "../geometry";
import type {
  Vec3,
  WorkerGeometryResult,
  WorkerBooleanResult,
  WorkerEdgeAnalysisResult,
  WorkerPreviewResult,
  WorkerSketchBrepResult,
  WorkerSketchProfilesResult,
  WorkerProcessProfileResult,
  WorkerImportResult,
  WorkerExportResult,
  WorkerEdgeLengthResult,
  WorkerEdgeDirectionResult,
  WorkerSketchWireResult,
  ExtrudeRequest,
  SweepRequest,
  LoftRequest,
  RevolveRequest,
  FilletRequest,
  ChamferRequest,
  BooleanRequest,
  EdgeAnalysisRequest,
  PreviewGeometryRequest,
  SketchToBrepRequest,
  SketchToProfilesRequest,
  ProcessProfileRequest,
  UnifyCompoundRequest,
  ImportFileRequest,
  ExportFileRequest,
  EdgeLengthRequest,
  EdgeDirectionRequest,
  SketchToWireRequest,
} from "./occ-worker-types";
import {
  brepToOCShapeHelper,
  ocShapeToBRepHelper,
  deserializeShapeHelper,
  serializeShapeHelper,
  occBrepToOCShapeHelper,
  buildPlanarFaceFromBoundaryHelper,
  buildWireFromPointsHelper,
  extrudeShapeHelper,
  sweepShapeAdvancedHelper,
  revolveShapeHelper,
  loftShapesHelper,
  booleanUnionHelper,
  booleanDifferenceHelper,
  booleanIntersectionHelper,
  filletEdgesHelper,
  chamferEdgesHelper,
  getEdgeLineSegmentsPerEdgeHelper,
  shapeToRawGeometry,
  shapeToRawEdgeSegments,
  shapeToVertexPositionsHelper,
  computeBoundingBoxCenter,
  translateShape,
  calculateBrepBoundsFromJSON,
  buildSketchEdgesHelper,
  buildSketchPointMap,
  transformShapeToPlaneHelper,
  detectProfileRegionsHelper,
  calculateFaceAreaHelper,
  faceToBrepWithCenterHelper,
  readSTEPHelper,
  writeSTEPHelper,
  readSTLHelper,
  writeSTLHelper,
  writeIGESHelper,
  getEdgeLengthHelper,
  getEdgeDirectionAtMidpointHelper,
  sketchToWireHelper,
} from "../services/occ-helpers";

// ─── Helper: get clean face from BRep JSON or occBrep ─────────────

function getCleanFace(oc: OpenCascadeInstance, brepJson: BrepJSON, sourceOccBrep?: string): any {
  let cleanFace = null;
  if (sourceOccBrep) {
    try { cleanFace = deserializeShapeHelper(oc, sourceOccBrep); } catch { cleanFace = null; }
  }
  if (!cleanFace) {
    cleanFace = buildPlanarFaceFromBoundaryHelper(oc, brepJson);
  }
  if (!cleanFace) throw new Error("Could not build clean face from profile");
  return cleanFace;
}

// ─── Helper: post-process result shape into WorkerGeometryResult ──

function postProcessGeometry(
  oc: OpenCascadeInstance,
  resultShape: any,
): WorkerGeometryResult {
  // Get bounding box center (world space)
  const worldCenter = computeBoundingBoxCenter(oc, resultShape);

  // Convert to BRep JSON (centered at origin)
  const { brepJson } = ocShapeToBRepHelper(oc, resultShape, true);

  // Translate to local space for serialization
  const localShape = translateShape(oc, resultShape, { x: -worldCenter.x, y: -worldCenter.y, z: -worldCenter.z });

  // Serialize in local space
  let occBrep: string | undefined;
  try { occBrep = serializeShapeHelper(oc, localShape); } catch { /* best effort */ }

  // Extract edge geometry (in local space)
  const edgePositions = shapeToRawEdgeSegments(oc, localShape, 0.003);

  // Extract vertex positions (in local space)
  const vertexPositions = shapeToVertexPositionsHelper(oc, localShape);

  // Tessellate face geometry (in local space)
  const faceGeometry = shapeToRawGeometry(oc, localShape, 0.003, 0.1);

  return {
    brepJson,
    positionOffset: worldCenter,
    occBrep,
    edgePositions,
    vertexPositions,
    faceGeometry,
  };
}

// ─── Handlers ─────────────────────────────────────────────────────

export function handleExtrude(oc: OpenCascadeInstance, payload: ExtrudeRequest["payload"]): WorkerGeometryResult {
  const cleanFace = getCleanFace(oc, payload.brepJson, payload.sourceOccBrep);
  const extrudedShape = extrudeShapeHelper(oc, cleanFace, payload.depth, payload.direction, payload.normalVec);
  return postProcessGeometry(oc, extrudedShape);
}

export function handleSweep(oc: OpenCascadeInstance, payload: SweepRequest["payload"]): WorkerGeometryResult {
  const cleanFace = getCleanFace(oc, payload.brepJson, payload.sourceOccBrep);

  // Translate path points into local space (relative to profile position)
  const localPathPoints = payload.pathPoints.map(p => ({
    x: p.x - payload.profilePosition.x,
    y: p.y - payload.profilePosition.y,
    z: p.z - payload.profilePosition.z,
  }));

  const pathWire = buildWireFromPointsHelper(oc, localPathPoints);
  if (!pathWire) throw new Error("Could not build path wire");

  const options = payload.options || { orientation: "perpendicular" as const, cornerMode: "right" as const };
  const sweptShape = sweepShapeAdvancedHelper(oc, cleanFace, pathWire, options);

  // Compute position offset from local-space result
  const localCenter = computeBoundingBoxCenter(oc, sweptShape);
  const { brepJson } = ocShapeToBRepHelper(oc, sweptShape, true);

  // Translate to origin for serialization
  const localShape = translateShape(oc, sweptShape, { x: -localCenter.x, y: -localCenter.y, z: -localCenter.z });
  let occBrep: string | undefined;
  try { occBrep = serializeShapeHelper(oc, localShape); } catch { /* best effort */ }

  const edgePositions = shapeToRawEdgeSegments(oc, localShape, 0.003);
  const vertexPositions = shapeToVertexPositionsHelper(oc, localShape);
  const faceGeometry = shapeToRawGeometry(oc, localShape, 0.003, 0.1);

  return {
    brepJson,
    positionOffset: localCenter, // caller adds profilePosition
    occBrep,
    edgePositions,
    vertexPositions,
    faceGeometry,
  };
}

export function handleLoft(oc: OpenCascadeInstance, payload: LoftRequest["payload"]): WorkerGeometryResult {
  // Prepare profile faces in world position
  const worldFaces = payload.profiles.map(profile => {
    let face: any;
    if (profile.occBrep) {
      try { face = deserializeShapeHelper(oc, profile.occBrep); } catch { face = null; }
    }
    if (!face) face = buildPlanarFaceFromBoundaryHelper(oc, profile.brepJson);
    if (!face) throw new Error("Could not build face for loft profile");

    // Transform to world position
    if (profile.position.x !== 0 || profile.position.y !== 0 || profile.position.z !== 0) {
      face = translateShape(oc, face, profile.position);
    }
    return face;
  });

  const loftedShape = loftShapesHelper(oc, worldFaces, true, payload.isRuled ?? false);
  return postProcessGeometry(oc, loftedShape);
}

export function handleRevolve(oc: OpenCascadeInstance, payload: RevolveRequest["payload"]): WorkerGeometryResult {
  const cleanFace = getCleanFace(oc, payload.brepJson, payload.sourceOccBrep);

  // Translate face to world position
  const positionedFace = translateShape(oc, cleanFace, payload.profilePosition);

  let revolvedShape = revolveShapeHelper(oc, positionedFace, payload.axisOrigin, payload.axisDir, payload.angleRadians);

  // Handle two-sided revolve
  if (payload.direction === "two" && payload.angleRadians2) {
    const reverseDir = { x: -payload.axisDir.x, y: -payload.axisDir.y, z: -payload.axisDir.z };
    const reverseShape = revolveShapeHelper(oc, positionedFace, payload.axisOrigin, reverseDir, payload.angleRadians2);
    revolvedShape = booleanUnionHelper(oc, revolvedShape, reverseShape);
  }

  const result = postProcessGeometry(oc, revolvedShape);
  // Convert world-space center to relative offset
  result.positionOffset = {
    x: result.positionOffset.x - payload.profilePosition.x,
    y: result.positionOffset.y - payload.profilePosition.y,
    z: result.positionOffset.z - payload.profilePosition.z,
  };
  return result;
}

export function handleFillet(oc: OpenCascadeInstance, payload: FilletRequest["payload"]): WorkerGeometryResult {
  // Reconstruct world shape
  let worldShape: any;
  if (payload.occBrep) {
    worldShape = occBrepToOCShapeHelper(oc, payload.occBrep, payload.position);
  } else {
    worldShape = brepToOCShapeHelper(oc, payload.brepJson, payload.position);
  }

  // Apply rotation if present
  if (payload.rotation) {
    worldShape = applyRotation(oc, worldShape, payload.rotation);
  }

  const skipFix = !!payload.occBrep;
  const filleted = filletEdgesHelper(oc, worldShape, payload.edgeIndices, payload.radius, skipFix);
  const result = postProcessResult(oc, filleted, payload.rotation);
  // Convert world-space center to relative offset
  result.positionOffset = {
    x: result.positionOffset.x - payload.position.x,
    y: result.positionOffset.y - payload.position.y,
    z: result.positionOffset.z - payload.position.z,
  };
  return result;
}

export function handleChamfer(oc: OpenCascadeInstance, payload: ChamferRequest["payload"]): WorkerGeometryResult {
  let worldShape: any;
  if (payload.occBrep) {
    worldShape = occBrepToOCShapeHelper(oc, payload.occBrep, payload.position);
  } else {
    worldShape = brepToOCShapeHelper(oc, payload.brepJson, payload.position);
  }
  if (payload.rotation) worldShape = applyRotation(oc, worldShape, payload.rotation);

  const skipFix = !!payload.occBrep;
  const chamfered = chamferEdgesHelper(oc, worldShape, payload.edgeIndices, payload.distance, skipFix);
  const result = postProcessResult(oc, chamfered, payload.rotation);
  // Convert world-space center to relative offset
  result.positionOffset = {
    x: result.positionOffset.x - payload.position.x,
    y: result.positionOffset.y - payload.position.y,
    z: result.positionOffset.z - payload.position.z,
  };
  return result;
}

function applyRotation(oc: OpenCascadeInstance, shape: any, rotation: { x: number; y: number; z: number; order: string }): any {
  // Convert Euler to quaternion manually (XYZ order)
  const cx = Math.cos(rotation.x / 2), sx = Math.sin(rotation.x / 2);
  const cy = Math.cos(rotation.y / 2), sy = Math.sin(rotation.y / 2);
  const cz = Math.cos(rotation.z / 2), sz = Math.sin(rotation.z / 2);
  const qx = sx * cy * cz + cx * sy * sz;
  const qy = cx * sy * cz - sx * cy * sz;
  const qz = cx * cy * sz + sx * sy * cz;
  const qw = cx * cy * cz - sx * sy * sz;

  const quat = new oc.gp_Quaternion_2(qx, qy, qz, qw);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_2(quat);
  quat.delete();
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  trsf.delete();
  const result = transformer.Shape();
  transformer.delete();
  return result;
}

function postProcessResult(oc: OpenCascadeInstance, resultShape: any, rotation?: { x: number; y: number; z: number; order: string }): WorkerGeometryResult {
  const worldCenter = computeBoundingBoxCenter(oc, resultShape);

  // Un-rotate for local space if rotation was applied
  let localShape = translateShape(oc, resultShape, { x: -worldCenter.x, y: -worldCenter.y, z: -worldCenter.z });
  if (rotation && (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0)) {
    // Apply inverse rotation
    const invRotation = { x: -rotation.x, y: -rotation.y, z: -rotation.z, order: rotation.order };
    localShape = applyRotation(oc, localShape, invRotation);
  }

  const { brepJson } = ocShapeToBRepHelper(oc, localShape, true);
  let occBrep: string | undefined;
  try { occBrep = serializeShapeHelper(oc, localShape); } catch { /* best effort */ }

  const edgePositions = shapeToRawEdgeSegments(oc, localShape, 0.003);
  const vertexPositions = shapeToVertexPositionsHelper(oc, localShape);
  const faceGeometry = shapeToRawGeometry(oc, localShape, 0.003, 0.1);

  return { brepJson, positionOffset: worldCenter, occBrep, edgePositions, vertexPositions, faceGeometry };
}

export function handleBoolean(oc: OpenCascadeInstance, payload: BooleanRequest["payload"]): WorkerBooleanResult {
  // Convert all operands to world-space OCC shapes
  const shapes = payload.operands.map(op => {
    if (op.occBrep) return occBrepToOCShapeHelper(oc, op.occBrep, op.position);
    return brepToOCShapeHelper(oc, op.brepJson, op.position);
  });

  if (shapes.length < 2) throw new Error("Need at least 2 operands for boolean");

  // Apply operation sequentially
  let resultShape = shapes[0];
  const booleanFn = payload.operation === "union" ? booleanUnionHelper
    : payload.operation === "difference" ? booleanDifferenceHelper
    : booleanIntersectionHelper;

  for (let i = 1; i < shapes.length; i++) {
    resultShape = booleanFn(oc, resultShape, shapes[i]);
  }

  const worldCenter = computeBoundingBoxCenter(oc, resultShape);
  const { brepJson } = ocShapeToBRepHelper(oc, resultShape, true);
  const localShape = translateShape(oc, resultShape, { x: -worldCenter.x, y: -worldCenter.y, z: -worldCenter.z });

  let occBrep: string | undefined;
  try { occBrep = serializeShapeHelper(oc, localShape); } catch { /* best effort */ }

  const edgePositions = shapeToRawEdgeSegments(oc, localShape, 0.003);
  const vertexPositions = shapeToVertexPositionsHelper(oc, localShape);
  const faceGeometry = shapeToRawGeometry(oc, localShape, 0.003, 0.1);

  return {
    brepJson,
    position: worldCenter,
    occBrep,
    edgePositions,
    vertexPositions,
    faceGeometry,
    removedNodeIds: [],
  };
}

export function handleEdgeAnalysis(oc: OpenCascadeInstance, payload: EdgeAnalysisRequest["payload"]): WorkerEdgeAnalysisResult {
  let shape: any;
  if (payload.occBrep) {
    shape = occBrepToOCShapeHelper(oc, payload.occBrep, payload.position);
  } else {
    shape = brepToOCShapeHelper(oc, payload.brepJson, payload.position);
  }
  if (payload.rotation) shape = applyRotation(oc, shape, payload.rotation);

  const skipFix = !!payload.occBrep;
  const edges = getEdgeLineSegmentsPerEdgeHelper(oc, shape, 0.003, skipFix, payload.allEdges);
  return { edges };
}

export function handlePreviewGeometry(oc: OpenCascadeInstance, payload: PreviewGeometryRequest["payload"]): WorkerPreviewResult {
  const cleanFace = getCleanFace(oc, payload.brepJson, payload.sourceOccBrep);
  // Extrude unit depth for preview
  const previewShape = extrudeShapeHelper(oc, cleanFace, 1, 1, payload.normalVec);
  const faceGeometry = shapeToRawGeometry(oc, previewShape, 0.1, 0.5);
  return { faceGeometry };
}

export function handleSketchToBrep(oc: OpenCascadeInstance, payload: SketchToBrepRequest["payload"]): WorkerSketchBrepResult {
  const nonConstructionPrimitives = payload.primitives.filter((p: any) => !p.construction);
  const pointMap = buildSketchPointMap(payload.primitives);
  const { circleEdges, otherEdges } = buildSketchEdgesHelper(oc, nonConstructionPrimitives, pointMap);

  // Build faces
  const faces: any[] = [];
  for (const edge of circleEdges) {
    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
    wireBuilder.Add_1(edge);
    if (wireBuilder.IsDone()) {
      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wireBuilder.Wire(), true);
      if (faceBuilder.IsDone()) faces.push(faceBuilder.Face());
    }
  }
  if (otherEdges.length > 0) {
    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
    for (const edge of otherEdges) wireBuilder.Add_1(edge);
    if (wireBuilder.IsDone()) {
      const wire = wireBuilder.Wire();
      if (wire.Closed_1()) {
        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
        if (faceBuilder.IsDone()) faces.push(faceBuilder.Face());
      }
    }
  }

  if (faces.length === 0) return { brepJson: { vertices: [], edges: [], faces: [] } };

  // Union faces
  let resultShape: any = faces[0];
  for (let i = 1; i < faces.length; i++) {
    try {
      const progressRange = new oc.Message_ProgressRange_1();
      const fuser = new oc.BRepAlgoAPI_Fuse_3(resultShape, faces[i], progressRange);
      if (fuser.IsDone()) resultShape = fuser.Shape();
      fuser.delete(); progressRange.delete();
    } catch { /* continue */ }
  }

  // Transform to plane
  resultShape = transformShapeToPlaneHelper(oc, resultShape, payload.plane);
  const { brepJson } = ocShapeToBRepHelper(oc, resultShape, false);
  return { brepJson };
}

export function handleSketchToProfiles(oc: OpenCascadeInstance, payload: SketchToProfilesRequest["payload"]): WorkerSketchProfilesResult {
  const nonConstructionPrimitives = payload.primitives.filter((p: any) => !p.construction);
  const pointMap = buildSketchPointMap(payload.primitives);
  const { circleEdges, otherEdges } = buildSketchEdgesHelper(oc, nonConstructionPrimitives, pointMap);

  // Detect profile regions
  const allEdges = [...circleEdges, ...otherEdges];
  if (allEdges.length === 0) return { profiles: [], success: false };

  let detectedFaces = detectProfileRegionsHelper(oc, allEdges);

  // Fallback: build faces separately
  if (detectedFaces.length === 0) {
    const faces: any[] = [];
    for (const edge of circleEdges) {
      const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
      wireBuilder.Add_1(edge);
      if (wireBuilder.IsDone()) {
        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wireBuilder.Wire(), true);
        if (faceBuilder.IsDone()) faces.push(faceBuilder.Face());
      }
    }
    if (otherEdges.length > 0) {
      const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
      for (const edge of otherEdges) wireBuilder.Add_1(edge);
      if (wireBuilder.IsDone()) {
        const wire = wireBuilder.Wire();
        if (wire.Closed_1()) {
          const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
          if (faceBuilder.IsDone()) faces.push(faceBuilder.Face());
        }
      }
    }
    detectedFaces = faces;
  }

  // Transform faces to plane and build profiles
  detectedFaces = detectedFaces.map(face => {
    const transformed = transformShapeToPlaneHelper(oc, face, payload.plane);
    return oc.TopoDS.Face_1(transformed);
  });

  const profiles: WorkerSketchProfilesResult["profiles"] = [];
  for (let i = 0; i < detectedFaces.length; i++) {
    const face = detectedFaces[i];
    const area = calculateFaceAreaHelper(oc, face);
    if (Math.abs(area) < 1e-6) continue;

    const { brepJson, center } = faceToBrepWithCenterHelper(oc, face);
    if (brepJson.faces.length === 0) continue;

    // Serialize analytic face in local space
    let profileOccBrep: string | undefined;
    try {
      const centeredFace = translateShape(oc, face, { x: -center.x, y: -center.y, z: -center.z });
      profileOccBrep = serializeShapeHelper(oc, centeredFace);
    } catch { /* best effort */ }

    profiles.push({
      id: `${payload.sketchId}_profile_${i}`,
      brepJson,
      area: Math.abs(area),
      isOuter: area < 0,
      center,
      occBrep: profileOccBrep,
    });
  }

  return { profiles, success: profiles.length > 0 };
}

export function handleProcessProfile(oc: OpenCascadeInstance, payload: ProcessProfileRequest["payload"]): WorkerProcessProfileResult {
  let shape: any;
  if (payload.occBrep) {
    try { shape = deserializeShapeHelper(oc, payload.occBrep); } catch { shape = null; }
  }
  if (!shape) shape = brepToOCShapeHelper(oc, payload.brepJson);

  let edgePositions: Float32Array | undefined;
  let vertexPositions: Float32Array | undefined;
  let occBrep: string | undefined;

  try {
    edgePositions = shapeToRawEdgeSegments(oc, shape, 0.003, true);
    vertexPositions = shapeToVertexPositionsHelper(oc, shape, true);
  } catch { /* optional */ }

  // Ensure occBrep is available
  if (!payload.occBrep) {
    try { occBrep = serializeShapeHelper(oc, shape); } catch { /* optional */ }
  } else {
    occBrep = payload.occBrep;
  }

  return { edgePositions, vertexPositions, occBrep };
}

export function handleUnifyCompound(oc: OpenCascadeInstance, payload: UnifyCompoundRequest["payload"]): { brepJson: BrepJSON } {
  const children = payload.childrenBrepJson;
  if (children.length === 0) return { brepJson: { vertices: [], edges: [], faces: [] } };
  if (children.length === 1) {
    const { brepJson } = ocShapeToBRepHelper(oc, brepToOCShapeHelper(oc, children[0]), false);
    return { brepJson };
  }

  let resultShape = brepToOCShapeHelper(oc, children[0]);
  for (let i = 1; i < children.length; i++) {
    const nextShape = brepToOCShapeHelper(oc, children[i]);
    resultShape = booleanUnionHelper(oc, resultShape, nextShape);
  }

  const { brepJson } = ocShapeToBRepHelper(oc, resultShape, false);
  return { brepJson };
}

export function handleImportFile(oc: OpenCascadeInstance, payload: ImportFileRequest["payload"]): WorkerImportResult {
  let shapes: any[];
  if (payload.format === "step") {
    shapes = readSTEPHelper(oc, payload.fileBytes);
  } else if (payload.format === "stl") {
    shapes = [readSTLHelper(oc, payload.fileBytes)];
  } else {
    throw new Error(`Unsupported import format: ${payload.format}`);
  }

  // Decompose compound shapes
  const elements: WorkerImportResult["elements"] = [];
  for (const shape of shapes) {
    const decomposed = decomposeShapeForImport(oc, shape);
    elements.push(...decomposed);
  }
  return { elements };
}

function decomposeShapeForImport(oc: OpenCascadeInstance, shape: any): WorkerImportResult["elements"] {
  const results: WorkerImportResult["elements"] = [];

  if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_COMPOUND) {
    const iterator = new oc.TopoDS_Iterator_2(shape, true, true);
    while (iterator.More()) {
      const result = decomposeChildForImport(oc, iterator.Value());
      results.push(result);
      iterator.Next();
    }
    iterator.delete();
    if (results.length === 0) results.push(decomposeChildForImport(oc, shape));
  } else {
    results.push(decomposeChildForImport(oc, shape));
  }
  return results;
}

function decomposeChildForImport(oc: OpenCascadeInstance, shape: any): WorkerImportResult["elements"][0] {
  const position = computeBoundingBoxCenter(oc, shape);
  const { brepJson } = ocShapeToBRepHelper(oc, shape, true);

  let occBrep: string | undefined;
  try {
    const localShape = translateShape(oc, shape, { x: -position.x, y: -position.y, z: -position.z });
    occBrep = serializeShapeHelper(oc, localShape);
  } catch { /* best effort */ }

  let edgePositions: Float32Array | undefined;
  let vertexPositions: Float32Array | undefined;
  try {
    const edgeGeo = shapeToRawEdgeSegments(oc, shape, 0.003);
    // Translate to local space
    edgePositions = new Float32Array(edgeGeo.length);
    for (let i = 0; i < edgeGeo.length; i += 3) {
      edgePositions[i] = edgeGeo[i] - position.x;
      edgePositions[i + 1] = edgeGeo[i + 1] - position.y;
      edgePositions[i + 2] = edgeGeo[i + 2] - position.z;
    }
    const vPos = shapeToVertexPositionsHelper(oc, shape);
    vertexPositions = new Float32Array(vPos.length);
    for (let i = 0; i < vPos.length; i += 3) {
      vertexPositions[i] = vPos[i] - position.x;
      vertexPositions[i + 1] = vPos[i + 1] - position.y;
      vertexPositions[i + 2] = vPos[i + 2] - position.z;
    }
  } catch { /* optional */ }

  return { brepJson, position, occBrep, edgePositions, vertexPositions };
}

export function handleExportFile(oc: OpenCascadeInstance, payload: ExportFileRequest["payload"]): WorkerExportResult {
  // Build compound from elements
  const builder = new oc.BRep_Builder();
  const compound = new oc.TopoDS_Compound();
  builder.MakeCompound(compound);

  for (const el of payload.elements) {
    const shape = el.occBrep
      ? occBrepToOCShapeHelper(oc, el.occBrep, el.position)
      : brepToOCShapeHelper(oc, el.brepJson, el.position);
    builder.Add(compound, shape);
  }

  let fileBytes: Uint8Array;
  if (payload.format === "step") {
    fileBytes = writeSTEPHelper(oc, compound);
  } else if (payload.format === "stl") {
    fileBytes = writeSTLHelper(oc, compound);
  } else if (payload.format === "iges") {
    fileBytes = writeIGESHelper(oc, compound);
  } else {
    throw new Error(`Unsupported export format: ${payload.format}`);
  }
  return { fileBytes };
}

// ─── Measure: edge length ─────────────────────────────────────────

export function handleEdgeLength(
  oc: OpenCascadeInstance,
  payload: EdgeLengthRequest["payload"],
): WorkerEdgeLengthResult {
  const hasOccBrep = !!payload.occBrep;
  const shape = buildWorldShape(oc, payload.brepJson, payload.position, payload.occBrep, payload.rotation);
  const length = getEdgeLengthHelper(oc, shape, payload.edgeIndex, hasOccBrep);
  return { length };
}

// ─── Measure: edge direction at midpoint ──────────────────────────

export function handleEdgeDirection(
  oc: OpenCascadeInstance,
  payload: EdgeDirectionRequest["payload"],
): WorkerEdgeDirectionResult {
  const hasOccBrep = !!payload.occBrep;
  const shape = buildWorldShape(oc, payload.brepJson, payload.position, payload.occBrep, payload.rotation);
  const direction = getEdgeDirectionAtMidpointHelper(oc, shape, payload.edgeIndex, hasOccBrep);
  return { direction };
}

// ─── Sketch to wire (for sweep path) ─────────────────────────────

export function handleSketchToWire(
  oc: OpenCascadeInstance,
  payload: SketchToWireRequest["payload"],
): WorkerSketchWireResult | null {
  const result = sketchToWireHelper(oc, payload.primitives, payload.plane);
  return result;
}

// ─── Shared: build world-space shape from BRep + position + rotation ──

function buildWorldShape(
  oc: OpenCascadeInstance,
  brepJson: BrepJSON,
  position: Vec3,
  occBrep?: string,
  rotation?: { x: number; y: number; z: number; order: string },
): any {
  const hasRotation = rotation &&
    (Math.abs(rotation.x) > 1e-9 || Math.abs(rotation.y) > 1e-9 || Math.abs(rotation.z) > 1e-9);

  if (hasRotation) {
    // Deserialize/build shape at origin first
    const localShape = occBrep
      ? deserializeShapeHelper(oc, occBrep)
      : brepToOCShapeHelper(oc, brepJson);

    // Apply rotation then translation
    const rotatedShape = applyRotation(oc, localShape, rotation!);
    const vec = new oc.gp_Vec_4(position.x, position.y, position.z);
    const trsf = new oc.gp_Trsf_1();
    trsf.SetTranslationPart(vec);
    vec.delete();
    const transformer = new oc.BRepBuilderAPI_Transform_2(rotatedShape, trsf, true);
    trsf.delete();
    const result = transformer.Shape();
    transformer.delete();
    return result;
  } else {
    return occBrep
      ? occBrepToOCShapeHelper(oc, occBrep, position)
      : brepToOCShapeHelper(oc, brepJson, position);
  }
}
