import { Brep } from "../geometry";
import * as THREE from "three";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerGeometryResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry, reconstructFaceGeometry } from "../workers/geometry-reconstruction";

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
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerGeometryResult>({
      type: "loft",
      payload: {
        profiles: profiles.map(p => ({
          brepJson: p.brep.toJSON(),
          position: { x: p.position.x, y: p.position.y, z: p.position.z },
          occBrep: p.occBrep,
        })),
        isRuled,
      },
    });

    const centeredBrep = Brep.fromJSON(raw.brepJson);
    const edgeGeometry = raw.edgePositions ? reconstructEdgeGeometry(raw.edgePositions) : undefined;
    const faceGeometry = raw.faceGeometry ? reconstructFaceGeometry(raw.faceGeometry) : undefined;

    return {
      brep: centeredBrep,
      position: new THREE.Vector3(raw.positionOffset.x, raw.positionOffset.y, raw.positionOffset.z),
      edgeGeometry,
      vertexPositions: raw.vertexPositions,
      occBrep: raw.occBrep,
      faceGeometry,
    };
  } catch (error) {
    console.error("[loftBReps] Loft operation failed:", error);
    return null;
  }
}
