import { Brep } from "../geometry";
import * as THREE from "three";
import { OpenCascadeService } from "../services/OpenCascadeService";

export interface LoftResult {
  brep: Brep;
  position: THREE.Vector3;
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
  occBrep?: string;
  faceGeometry?: THREE.BufferGeometry;
}

/**
 * Loft through multiple flat BRep profiles to create a smooth blended solid.
 *
 * Process:
 * 1. For each profile: build clean planar face, transform to world position
 * 2. Loft all faces via OCC's BRepOffsetAPI_ThruSections
 * 3. Convert result to centered BRep + position (bounding box center)
 *
 * @param profiles Ordered array of { brep, position } pairs
 * @param isRuled Whether to use ruled surfaces (linear) vs smooth interpolation
 */
export async function loftBReps(
  profiles: { brep: Brep; position: THREE.Vector3; occBrep?: string }[],
  isRuled: boolean = false
): Promise<LoftResult | null> {
  if (profiles.length < 2) {
    console.warn("[loftBReps] Need at least 2 profiles");
    return null;
  }

  try {
    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    // Build world-positioned faces for each profile
    const worldFaces: any[] = [];

    for (let i = 0; i < profiles.length; i++) {
      const { brep, position, occBrep } = profiles[i];

      // Prefer deserializing occBrep (preserves analytic geometry like circles),
      // fall back to extracting boundary from tessellated BRep.
      let cleanFace;
      if (occBrep) {
        try {
          cleanFace = await ocService.deserializeShape(occBrep);
        } catch {
          cleanFace = null;
        }
      }
      if (!cleanFace) {
        cleanFace = await ocService.buildPlanarFaceFromBoundary(brep);
      }
      if (!cleanFace) {
        console.error(`[loftBReps] Failed to build clean face for profile ${i}`);
        return null;
      }

      // Transform to world position
      const trsf = new oc.gp_Trsf_1();
      const vec = new oc.gp_Vec_4(position.x, position.y, position.z);
      trsf.SetTranslation_1(vec);
      vec.delete();

      let transformer: any = null;
      try {
        transformer = new oc.BRepBuilderAPI_Transform_2(cleanFace, trsf, true);
        worldFaces.push(transformer.Shape());
      } finally {
        trsf.delete();
        transformer?.delete();
      }
    }

    // Loft all faces
    const loftedShape = await ocService.loftShapes(worldFaces, true, isRuled);

    // Get uncentered BRep to compute bounding box center for position
    const uncenteredBrep = await ocService.ocShapeToBRep(loftedShape, false);
    const xs = uncenteredBrep.vertices.map(v => v.x);
    const ys = uncenteredBrep.vertices.map(v => v.y);
    const zs = uncenteredBrep.vertices.map(v => v.z);
    const centerPos = new THREE.Vector3(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    );

    // Convert to centered BRep
    const centeredBrep = await ocService.ocShapeToBRep(loftedShape, true);

    // Extract edge geometry, face geometry, and vertex positions
    let edgeGeometry: THREE.BufferGeometry | undefined;
    let faceGeometry: THREE.BufferGeometry | undefined;
    let vertexPositions: Float32Array | undefined;
    try {
      edgeGeometry = await ocService.shapeToEdgeLineSegments(loftedShape, 0.003);
      edgeGeometry.translate(-centerPos.x, -centerPos.y, -centerPos.z);
    } catch (e) {
      console.warn("[loftBReps] Edge geometry extraction failed:", e);
    }

    try {
      faceGeometry = await ocService.shapeToThreeGeometry(loftedShape, 0.003, 0.1);
      faceGeometry.translate(-centerPos.x, -centerPos.y, -centerPos.z);
    } catch (e) {
      console.warn("[loftBReps] Face geometry extraction failed:", e);
    }

    try {
      vertexPositions = await ocService.shapeToVertexPositions(loftedShape);
      for (let i = 0; i < vertexPositions.length; i += 3) {
        vertexPositions[i] -= centerPos.x;
        vertexPositions[i + 1] -= centerPos.y;
        vertexPositions[i + 2] -= centerPos.z;
      }
    } catch (e) {
      console.warn("[loftBReps] Vertex positions extraction failed:", e);
    }

    // Serialize loft result in local space for lossless round-tripping
    let occBrep: string | undefined;
    try {
      const trsf = new oc.gp_Trsf_1();
      const vec = new oc.gp_Vec_4(-centerPos.x, -centerPos.y, -centerPos.z);
      trsf.SetTranslation_1(vec);
      vec.delete();
      const transformer = new oc.BRepBuilderAPI_Transform_2(loftedShape, trsf, true);
      trsf.delete();
      const localShape = transformer.Shape();
      transformer.delete();
      occBrep = await ocService.serializeShape(localShape);
    } catch {
      // Serialization is best-effort
    }

    return { brep: centeredBrep, position: centerPos, edgeGeometry, vertexPositions, occBrep, faceGeometry };
  } catch (error) {
    console.error("[loftBReps] Loft operation failed:", error);
    return null;
  }
}
