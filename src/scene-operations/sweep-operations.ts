import { Brep } from "../geometry";
import * as THREE from "three";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerGeometryResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry, reconstructFaceGeometry } from "../workers/geometry-reconstruction";

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
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerGeometryResult>({
      type: "sweep",
      payload: {
        brepJson: profileBrep.toJSON(),
        profilePosition: { x: profilePosition.x, y: profilePosition.y, z: profilePosition.z },
        pathPoints,
        options,
        sourceOccBrep,
      },
    });

    // Reconstruct result
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
    console.error("[sweepBRep] Sweep operation failed:", error);
    return { brep: profileBrep, positionOffset: { x: 0, y: 0, z: 0 } };
  }
}
