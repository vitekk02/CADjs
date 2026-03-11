import * as THREE from "three";
import { Brep } from "../geometry";
import { OccWorkerClient } from "../services/OccWorkerClient";
import type { WorkerGeometryResult } from "../workers/occ-worker-types";
import { reconstructEdgeGeometry, reconstructFaceGeometry } from "../workers/geometry-reconstruction";

export interface FilletResult {
  brep: Brep;
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
  occBrep?: string;
  faceGeometry?: THREE.BufferGeometry;
  success: boolean;
  error?: string;
}

/**
 * Apply fillet (edge rounding) to a BRep's specified edges.
 * Returns the modified BRep (centered) and position offset.
 *
 * If occBrep is provided, deserializes it instead of reconstructing from
 * tessellated triangles — preserving analytic geometry for correct results.
 */
export async function filletBRep(
  brep: Brep,
  position: THREE.Vector3,
  edgeIndices: number[],
  radius: number,
  occBrep?: string,
  rotation?: THREE.Euler,
): Promise<FilletResult> {
  try {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerGeometryResult>({
      type: "fillet",
      payload: {
        brepJson: brep.toJSON(),
        position: { x: position.x, y: position.y, z: position.z },
        edgeIndices,
        radius,
        occBrep,
        rotation: rotation ? { x: rotation.x, y: rotation.y, z: rotation.z, order: rotation.order } : undefined,
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
      success: true,
    };
  } catch (error) {
    console.error("[filletBRep] Worker fillet operation failed:", error);
    return { brep, positionOffset: { x: 0, y: 0, z: 0 }, success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Apply chamfer (edge beveling) to a BRep's specified edges.
 * Returns the modified BRep (centered) and position offset.
 *
 * If occBrep is provided, deserializes it instead of reconstructing from
 * tessellated triangles — preserving analytic geometry for correct results.
 */
export async function chamferBRep(
  brep: Brep,
  position: THREE.Vector3,
  edgeIndices: number[],
  distance: number,
  occBrep?: string,
  rotation?: THREE.Euler,
): Promise<FilletResult> {
  try {
    const client = OccWorkerClient.getInstance();
    const raw = await client.send<WorkerGeometryResult>({
      type: "chamfer",
      payload: {
        brepJson: brep.toJSON(),
        position: { x: position.x, y: position.y, z: position.z },
        edgeIndices,
        distance,
        occBrep,
        rotation: rotation ? { x: rotation.x, y: rotation.y, z: rotation.z, order: rotation.order } : undefined,
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
      success: true,
    };
  } catch (error) {
    console.error("[chamferBRep] Worker chamfer operation failed:", error);
    return { brep, positionOffset: { x: 0, y: 0, z: 0 }, success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
