import { Brep } from "../geometry";
import * as THREE from "three";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerGeometryResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry, reconstructFaceGeometry } from "../workers/geometry-reconstruction";

export type RevolveDirection = "one" | "two" | "symmetric";

export interface RevolveResult {
  brep: Brep;
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
  occBrep?: string;
  faceGeometry?: THREE.BufferGeometry;
  errorReason?: string;
}

/**
 * Revolve a flat BRep profile around an axis to create a solid of revolution.
 *
 * Sends work to the OCC Web Worker. The worker handles:
 * 1. Build clean planar face from profile BRep boundary (raw BRep coords)
 * 2. Translate face to position frame (same frame as the edge overlay axis)
 * 3. Revolve positioned face around the axis via OCC MakeRevol
 * 4. Get uncentered BRep, compute bounding box center = positionOffset
 * 5. Center BRep at origin via transformBrepVertices
 * 6. positionOffset = localCenter - profilePosition (converts absolute -> relative)
 * 7. Caller applies: newPosition = profilePosition + positionOffset = localCenter
 */
export async function revolveBRep(
  profileBrep: Brep,
  profilePosition: THREE.Vector3,
  axisOrigin: { x: number; y: number; z: number },
  axisDir: { x: number; y: number; z: number },
  angleRadians?: number,
  sourceOccBrep?: string,
  direction: RevolveDirection = "one",
  angleRadians2?: number,
): Promise<RevolveResult> {
  if (!profileBrep.faces.length) {
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
  }

  try {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerGeometryResult>({
      type: "revolve",
      payload: {
        brepJson: profileBrep.toJSON(),
        profilePosition: { x: profilePosition.x, y: profilePosition.y, z: profilePosition.z },
        axisOrigin,
        axisDir,
        angleRadians,
        sourceOccBrep,
        direction,
        angleRadians2,
      },
    });

    const centeredBrep = Brep.fromJSON(raw.brepJson);
    const edgeGeometry = raw.edgePositions ? reconstructEdgeGeometry(raw.edgePositions) : undefined;
    const faceGeometry = raw.faceGeometry ? reconstructFaceGeometry(raw.faceGeometry) : undefined;

    return {
      brep: centeredBrep,
      positionOffset: raw.positionOffset,
      edgeGeometry,
      vertexPositions: raw.vertexPositions,
      occBrep: raw.occBrep,
      faceGeometry,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[revolveBRep] Revolve operation failed:", msg);
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 }, errorReason: msg };
  }
}
