import * as THREE from "three";
import { Brep } from "../geometry";
import { OpenCascadeService } from "../services/OpenCascadeService";

export interface FilletResult {
  brep: Brep;
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
}

/**
 * Apply fillet (edge rounding) to a BRep's specified edges.
 * Returns the modified BRep (centered) and position offset.
 */
export async function filletBRep(
  brep: Brep,
  position: THREE.Vector3,
  edgeIndices: number[],
  radius: number,
): Promise<FilletResult> {
  const ocService = OpenCascadeService.getInstance();
  const oc = await ocService.getOC();

  // Convert BRep to OCC shape at world position
  const shape = await ocService.brepToOCShape(brep, position);

  // Apply fillet
  const resultShape = await ocService.filletEdges(shape, edgeIndices, radius);

  // Compute bounding box center of the result (for re-centering)
  const bBox = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(resultShape, bBox, false);
  const worldCenter = new THREE.Vector3(
    (bBox.CornerMin().X() + bBox.CornerMax().X()) / 2,
    (bBox.CornerMin().Y() + bBox.CornerMax().Y()) / 2,
    (bBox.CornerMin().Z() + bBox.CornerMax().Z()) / 2,
  );

  // Convert back to centered BRep
  const centeredBrep = await ocService.ocShapeToBRep(resultShape, true);

  // Extract clean topological edges from OCC shape
  const edgeGeometry = await ocService.shapeToEdgeLineSegments(resultShape, 0.05);
  edgeGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);

  // Position offset = worldCenter - original position
  const positionOffset = {
    x: worldCenter.x - position.x,
    y: worldCenter.y - position.y,
    z: worldCenter.z - position.z,
  };

  return { brep: centeredBrep, positionOffset, edgeGeometry };
}

/**
 * Apply chamfer (edge beveling) to a BRep's specified edges.
 * Returns the modified BRep (centered) and position offset.
 */
export async function chamferBRep(
  brep: Brep,
  position: THREE.Vector3,
  edgeIndices: number[],
  distance: number,
): Promise<FilletResult> {
  const ocService = OpenCascadeService.getInstance();
  const oc = await ocService.getOC();

  // Convert BRep to OCC shape at world position
  const shape = await ocService.brepToOCShape(brep, position);

  // Apply chamfer
  const resultShape = await ocService.chamferEdges(shape, edgeIndices, distance);

  // Compute bounding box center of the result
  const bBox = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(resultShape, bBox, false);
  const worldCenter = new THREE.Vector3(
    (bBox.CornerMin().X() + bBox.CornerMax().X()) / 2,
    (bBox.CornerMin().Y() + bBox.CornerMax().Y()) / 2,
    (bBox.CornerMin().Z() + bBox.CornerMax().Z()) / 2,
  );

  // Convert back to centered BRep
  const centeredBrep = await ocService.ocShapeToBRep(resultShape, true);

  // Extract clean topological edges from OCC shape
  const edgeGeometry = await ocService.shapeToEdgeLineSegments(resultShape, 0.05);
  edgeGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);

  // Position offset = worldCenter - original position
  const positionOffset = {
    x: worldCenter.x - position.x,
    y: worldCenter.y - position.y,
    z: worldCenter.z - position.z,
  };

  return { brep: centeredBrep, positionOffset, edgeGeometry };
}
