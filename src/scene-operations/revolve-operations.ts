import { Brep } from "../geometry";
import { transformBrepVertices } from "../convertBRepToGeometry";
import * as THREE from "three";
import { OpenCascadeService } from "../services/OpenCascadeService";

export interface RevolveResult {
  brep: Brep;
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
  occBrep?: string;
  faceGeometry?: THREE.BufferGeometry;
}

/**
 * Revolve a flat BRep profile around an axis to create a solid of revolution.
 *
 * 1. Build clean planar face from profile BRep boundary (raw BRep coords)
 * 2. Translate face to position frame (same frame as the edge overlay axis)
 * 3. Revolve positioned face around the axis via OCC MakeRevol
 * 4. Get uncentered BRep, compute bounding box center = positionOffset
 * 5. Center BRep at origin via transformBrepVertices
 * 6. positionOffset = localCenter − profilePosition (converts absolute → relative)
 * 7. Caller applies: newPosition = profilePosition + positionOffset = localCenter
 */
export async function revolveBRep(
  profileBrep: Brep,
  profilePosition: THREE.Vector3,
  axisOrigin: { x: number; y: number; z: number },
  axisDir: { x: number; y: number; z: number },
  angleRadians?: number,
  sourceOccBrep?: string,
): Promise<RevolveResult> {
  if (!profileBrep.faces.length) {
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
  }

  try {
    const ocService = OpenCascadeService.getInstance();

    // 1. Build a clean planar face (at raw BRep coords — brepCenter frame)
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
      console.error("[revolveBRep] Failed to build clean face from profile");
      return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
    }

    // 2. Translate face from raw-BRep-coords frame to position frame.
    //
    // buildPlanarFaceFromBoundary calls brepToOCShape(brep) WITHOUT position,
    // so the face vertices are at raw BRep coords (centered at brepCenter).
    //
    // The axis comes from the edge overlay which uses
    // brepToOCShape(brep, element.position), so overlay coords are in
    // the "position frame" (vertices shifted from brepCenter → position).
    //
    // To put both in the same frame, translate the face by (position - brepCenter).
    const bxs = profileBrep.vertices.map(v => v.x);
    const bys = profileBrep.vertices.map(v => v.y);
    const bzs = profileBrep.vertices.map(v => v.z);
    const brepCenter = {
      x: (Math.min(...bxs) + Math.max(...bxs)) / 2,
      y: (Math.min(...bys) + Math.max(...bys)) / 2,
      z: (Math.min(...bzs) + Math.max(...bzs)) / 2,
    };

    const dx = profilePosition.x - brepCenter.x;
    const dy = profilePosition.y - brepCenter.y;
    const dz = profilePosition.z - brepCenter.z;

    const oc = await ocService.getOC();
    let positionedFace = cleanFace;

    // Only translate if shift is non-trivial
    if (Math.abs(dx) > 1e-10 || Math.abs(dy) > 1e-10 || Math.abs(dz) > 1e-10) {
      const trsf = new oc.gp_Trsf_1();
      const shiftVec = new oc.gp_Vec_4(dx, dy, dz);
      trsf.SetTranslation_1(shiftVec);
      shiftVec.delete();
      const transformer = new oc.BRepBuilderAPI_Transform_2(cleanFace, trsf, true);
      trsf.delete();
      positionedFace = transformer.Shape();
      transformer.delete();
    }

    // 3. Revolve — face and axis are both in position frame, no axis shift needed
    const revolvedShape = await ocService.revolveShape(
      positionedFace,
      axisOrigin,
      axisDir,
      angleRadians,
    );

    // 4. Get uncentered BRep to compute bounding box center
    const uncenteredBrep = await ocService.ocShapeToBRep(revolvedShape, false);
    const xs = uncenteredBrep.vertices.map(v => v.x);
    const ys = uncenteredBrep.vertices.map(v => v.y);
    const zs = uncenteredBrep.vertices.map(v => v.z);
    const localCenter = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    };

    // 5. Center BRep at origin
    const centerVec = new THREE.Vector3(localCenter.x, localCenter.y, localCenter.z);
    const originVec = new THREE.Vector3(0, 0, 0);
    const centeredBrep = transformBrepVertices(uncenteredBrep, centerVec, originVec);

    // The revolve was done in position frame (absolute world coords), so
    // localCenter is an absolute coordinate. The caller adds profilePosition
    // on top, so subtract it to get a relative offset:
    //   newPosition = profilePosition + (localCenter - profilePosition) = localCenter  ✓
    const positionOffset = {
      x: localCenter.x - profilePosition.x,
      y: localCenter.y - profilePosition.y,
      z: localCenter.z - profilePosition.z,
    };

    // Extract edge geometry, face geometry, and vertex positions, translated to centered local space
    let edgeGeometry: THREE.BufferGeometry | undefined;
    let faceGeometry: THREE.BufferGeometry | undefined;
    let vertexPositions: Float32Array | undefined;
    try {
      edgeGeometry = await ocService.shapeToEdgeLineSegments(revolvedShape, 0.003);
      edgeGeometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    } catch (e) {
      console.warn("[revolveBRep] Edge geometry extraction failed:", e);
    }

    try {
      faceGeometry = await ocService.shapeToThreeGeometry(revolvedShape, 0.003, 0.1);
      faceGeometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    } catch (e) {
      console.warn("[revolveBRep] Face geometry extraction failed:", e);
    }

    try {
      vertexPositions = await ocService.shapeToVertexPositions(revolvedShape);
      for (let i = 0; i < vertexPositions.length; i += 3) {
        vertexPositions[i] -= localCenter.x;
        vertexPositions[i + 1] -= localCenter.y;
        vertexPositions[i + 2] -= localCenter.z;
      }
    } catch (e) {
      console.warn("[revolveBRep] Vertex positions extraction failed:", e);
    }

    // Serialize revolve result in local space for lossless round-tripping
    let occBrep: string | undefined;
    try {
      const trsf = new oc.gp_Trsf_1();
      const vec = new oc.gp_Vec_4(-localCenter.x, -localCenter.y, -localCenter.z);
      trsf.SetTranslation_1(vec);
      vec.delete();
      const transformer = new oc.BRepBuilderAPI_Transform_2(revolvedShape, trsf, true);
      trsf.delete();
      const localShape = transformer.Shape();
      transformer.delete();
      occBrep = await ocService.serializeShape(localShape);
    } catch {
      // Serialization is best-effort
    }

    return { brep: centeredBrep, positionOffset, edgeGeometry, vertexPositions, occBrep, faceGeometry };
  } catch (error) {
    console.error("[revolveBRep] Revolve operation failed:", error);
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
  }
}
