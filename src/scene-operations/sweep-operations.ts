import { Brep } from "../geometry";
import { transformBrepVertices } from "../convertBRepToGeometry";
import * as THREE from "three";
import { OpenCascadeService } from "../services/OpenCascadeService";

export type SweepOrientation = "perpendicular" | "parallel";
export type SweepCornerMode = "right" | "round";
export interface SweepOptions {
  orientation: SweepOrientation;
  cornerMode: SweepCornerMode;
}

export interface SweepResult {
  brep: Brep;
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
  occBrep?: string;
  faceGeometry?: THREE.BufferGeometry;
}

/**
 * Sweep a flat BRep profile along a path defined by ordered points.
 *
 * Follows the same local-space pattern as extrudeBRep:
 * 1. Build clean planar face from profile BRep boundary (at origin)
 * 2. Translate path into profile's local coordinate frame (path - profilePosition)
 * 3. Sweep origin-centered face along local-space wire via OCC's MakePipe
 * 4. Get uncentered BRep, compute bounding box center = positionOffset
 * 5. Center BRep at origin via transformBrepVertices
 * 6. Caller applies: newPosition = profilePosition + positionOffset
 */
export async function sweepBRep(
  profileBrep: Brep,
  profilePosition: THREE.Vector3,
  pathPoints: { x: number; y: number; z: number }[],
  options?: SweepOptions,
  sourceOccBrep?: string,
): Promise<SweepResult> {
  if (!profileBrep.faces.length || pathPoints.length < 2) {
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
  }

  try {
    const ocService = OpenCascadeService.getInstance();

    // 1. Build a clean planar face at LOCAL ORIGIN (same as extrusion)
    // Prefer deserializing sourceOccBrep (preserves analytic geometry like circles),
    // fall back to extracting boundary from tessellated BRep.
    let cleanFace;
    if (sourceOccBrep) {
      try {
        cleanFace = await ocService.deserializeShape(sourceOccBrep);
      } catch {
        cleanFace = null;
      }
    }
    if (!cleanFace) {
      cleanFace = await ocService.buildPlanarFaceFromBoundary(profileBrep);
    }
    if (!cleanFace) {
      console.error("[sweepBRep] Failed to build clean face from profile");
      return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
    }

    // 2. Translate path into local space (relative to face at origin).
    //    Face stays at origin; path is shifted by -profilePosition so
    //    the spatial relationship between profile and path is preserved.
    const localPathPoints = pathPoints.map(pt => ({
      x: pt.x - profilePosition.x,
      y: pt.y - profilePosition.y,
      z: pt.z - profilePosition.z,
    }));

    // 3. Build wire from local-space path points
    const pathWire = await ocService.buildWireFromPoints(localPathPoints);
    if (!pathWire) {
      console.error("[sweepBRep] Failed to build wire from path points");
      return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
    }

    // 4. Sweep origin-centered face along local-space wire
    const sweepOpts = options ?? { orientation: "perpendicular", cornerMode: "right" };
    const sweptShape = await ocService.sweepShapeAdvanced(cleanFace, pathWire, sweepOpts);

    // 5. Get uncentered BRep to compute bounding box center
    const uncenteredBrep = await ocService.ocShapeToBRep(sweptShape, false);
    const xs = uncenteredBrep.vertices.map(v => v.x);
    const ys = uncenteredBrep.vertices.map(v => v.y);
    const zs = uncenteredBrep.vertices.map(v => v.z);
    const localCenter = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    };

    // 6. Center BRep at origin
    const centerVec = new THREE.Vector3(localCenter.x, localCenter.y, localCenter.z);
    const originVec = new THREE.Vector3(0, 0, 0);
    const centeredBrep = transformBrepVertices(uncenteredBrep, centerVec, originVec);

    // positionOffset = localCenter (since we operated in local space,
    // the bounding box center IS the offset from profilePosition)
    const positionOffset = localCenter;

    // Extract edge geometry, face geometry, and vertex positions, translated to centered local space
    let edgeGeometry: THREE.BufferGeometry | undefined;
    let faceGeometry: THREE.BufferGeometry | undefined;
    let vertexPositions: Float32Array | undefined;
    try {
      edgeGeometry = await ocService.shapeToEdgeLineSegments(sweptShape, 0.003);
      edgeGeometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    } catch (e) {
      console.warn("[sweepBRep] Edge geometry extraction failed:", e);
    }

    try {
      faceGeometry = await ocService.shapeToThreeGeometry(sweptShape, 0.003, 0.1);
      faceGeometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    } catch (e) {
      console.warn("[sweepBRep] Face geometry extraction failed:", e);
    }

    try {
      vertexPositions = await ocService.shapeToVertexPositions(sweptShape);
      for (let i = 0; i < vertexPositions.length; i += 3) {
        vertexPositions[i] -= localCenter.x;
        vertexPositions[i + 1] -= localCenter.y;
        vertexPositions[i + 2] -= localCenter.z;
      }
    } catch (e) {
      console.warn("[sweepBRep] Vertex positions extraction failed:", e);
    }

    // Serialize sweep result in local space for lossless round-tripping
    let occBrep: string | undefined;
    try {
      const oc = await ocService.getOC();
      const trsf = new oc.gp_Trsf_1();
      const vec = new oc.gp_Vec_4(-localCenter.x, -localCenter.y, -localCenter.z);
      trsf.SetTranslation_1(vec);
      vec.delete();
      const transformer = new oc.BRepBuilderAPI_Transform_2(sweptShape, trsf, true);
      trsf.delete();
      const localShape = transformer.Shape();
      transformer.delete();
      occBrep = await ocService.serializeShape(localShape);
    } catch {
      // Serialization is best-effort
    }

    return { brep: centeredBrep, positionOffset, edgeGeometry, vertexPositions, occBrep, faceGeometry };
  } catch (error) {
    console.error("[sweepBRep] Sweep operation failed:", error);
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
  }
}
