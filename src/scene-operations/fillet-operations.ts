import type { TopoDS_Shape } from "opencascade.js";
import * as THREE from "three";
import { Brep } from "../geometry";
import { OpenCascadeService } from "../services/OpenCascadeService";

/**
 * Reconstruct OCC shape at world position+rotation.
 * Deserializes from occBrep if available, otherwise from tessellated brep.
 * Applies rotation (if any) around origin, then translates to position.
 */
async function buildWorldShape(
  ocService: OpenCascadeService,
  brep: Brep,
  position: THREE.Vector3,
  occBrep?: string,
  rotation?: THREE.Euler,
) {
  const hasRotation = rotation && (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0);

  if (!hasRotation) {
    // No rotation — use existing path (translation only)
    return occBrep
      ? await ocService.occBrepToOCShape(occBrep, position)
      : await ocService.brepToOCShape(brep, position);
  }

  // Build shape at origin first
  let shape = occBrep
    ? await ocService.occBrepToOCShape(occBrep)
    : await ocService.brepToOCShape(brep);

  // gp_Trsf composes as T * R: rotate around origin first, then translate.
  // This matches Three.js's model matrix (T * R * S with S=1).
  const oc = await ocService.getOC();
  const threeQuat = new THREE.Quaternion().setFromEuler(rotation);
  const ocQuat = new oc.gp_Quaternion_2(threeQuat.x, threeQuat.y, threeQuat.z, threeQuat.w);
  const vec = new oc.gp_Vec_4(position.x, position.y, position.z);

  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_2(ocQuat);
  trsf.SetTranslationPart(vec);

  ocQuat.delete();
  vec.delete();

  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  trsf.delete();
  shape = transformer.Shape();
  transformer.delete();

  return shape;
}

/**
 * Post-process a fillet/chamfer result shape: compute centered BRep,
 * extract edge geometry, serialize to local space, compute position offset.
 *
 * When the element has rotation, the serialized occBrep is un-rotated so
 * subsequent operations don't double-rotate the geometry.
 */
async function postProcessResult(
  ocService: OpenCascadeService,
  resultShape: TopoDS_Shape,
  position: THREE.Vector3,
  rotation?: THREE.Euler,
): Promise<FilletResult> {
  const hasRotation = rotation && (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0);

  // Get uncentered BRep to compute center from same data source as ocShapeToBRep(true)
  const uncenteredBrep = await ocService.ocShapeToBRep(resultShape, false);
  const xs = uncenteredBrep.vertices.map(v => v.x);
  const ys = uncenteredBrep.vertices.map(v => v.y);
  const zs = uncenteredBrep.vertices.map(v => v.z);
  const worldCenter = new THREE.Vector3(
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
    (Math.min(...zs) + Math.max(...zs)) / 2,
  );

  // Build transform to move result from world space back to local space (origin, un-rotated)
  const oc = await ocService.getOC();

  let localTrsf;
  if (hasRotation) {
    // Compose: translate to origin, then un-rotate = R^-1 * T(-center)
    const inverseQuat = new THREE.Quaternion().setFromEuler(rotation!).invert();
    const ocInvQuat = new oc.gp_Quaternion_2(inverseQuat.x, inverseQuat.y, inverseQuat.z, inverseQuat.w);

    const translateTrsf = new oc.gp_Trsf_1();
    const translateVec = new oc.gp_Vec_4(-worldCenter.x, -worldCenter.y, -worldCenter.z);
    translateTrsf.SetTranslation_1(translateVec);
    translateVec.delete();

    const rotateTrsf = new oc.gp_Trsf_1();
    rotateTrsf.SetRotation_2(ocInvQuat);
    ocInvQuat.delete();

    localTrsf = rotateTrsf.Multiplied(translateTrsf);
    rotateTrsf.delete();
    translateTrsf.delete();
  } else {
    localTrsf = new oc.gp_Trsf_1();
    const vec = new oc.gp_Vec_4(-worldCenter.x, -worldCenter.y, -worldCenter.z);
    localTrsf.SetTranslation_1(vec);
    vec.delete();
  }

  const transformer = new oc.BRepBuilderAPI_Transform_2(resultShape, localTrsf, true);
  localTrsf.delete();
  const localShape = transformer.Shape();
  transformer.delete();

  // Compute localShape's AABB center (delta). ocShapeToBRep(localShape, true) subtracts
  // this to produce centeredBrep. We need it for the position offset correction below.
  const localUncentered = await ocService.ocShapeToBRep(localShape, false);
  const lxs = localUncentered.vertices.map(v => v.x);
  const lys = localUncentered.vertices.map(v => v.y);
  const lzs = localUncentered.vertices.map(v => v.z);
  const localBBoxCenter = new THREE.Vector3(
    (Math.min(...lxs) + Math.max(...lxs)) / 2,
    (Math.min(...lys) + Math.max(...lys)) / 2,
    (Math.min(...lzs) + Math.max(...lzs)) / 2,
  );

  // Derive centered BRep from local-space shape (no rotation baked in).
  // updateElementBrep re-applies element.rotation to the mesh at render time.
  const centeredBrep = await ocService.ocShapeToBRep(localShape, true);

  // Extract clean topological edges and face geometry from local-space shape, centered to match centeredBrep
  const edgeGeometry = await ocService.shapeToEdgeLineSegments(localShape, 0.003);
  edgeGeometry.translate(-localBBoxCenter.x, -localBBoxCenter.y, -localBBoxCenter.z);
  const faceGeometry = await ocService.shapeToThreeGeometry(localShape, 0.003, 0.1);
  faceGeometry.translate(-localBBoxCenter.x, -localBBoxCenter.y, -localBBoxCenter.z);
  const vertexPositions = await ocService.shapeToVertexPositions(localShape);
  for (let i = 0; i < vertexPositions.length; i += 3) {
    vertexPositions[i] -= localBBoxCenter.x;
    vertexPositions[i + 1] -= localBBoxCenter.y;
    vertexPositions[i + 2] -= localBBoxCenter.z;
  }

  // Serialize local-space shape for lossless round-tripping
  const serializedOccBrep = await ocService.serializeShape(localShape);

  // Position offset correction:
  // centeredBrep vertices = localShapeVertex - localBBoxCenter
  // Three.js renders: worldPos = R * v + newPosition
  //   = R * (localShapeVertex - localBBoxCenter) + newPosition
  //   = (worldVertex - worldCenter) - R * localBBoxCenter + newPosition
  // For worldPos = worldVertex: newPosition = worldCenter + R * localBBoxCenter
  const rotatedDelta = localBBoxCenter.clone();
  if (hasRotation) {
    rotatedDelta.applyEuler(rotation!);
  }

  const positionOffset = {
    x: worldCenter.x + rotatedDelta.x - position.x,
    y: worldCenter.y + rotatedDelta.y - position.y,
    z: worldCenter.z + rotatedDelta.z - position.z,
  };

  return { brep: centeredBrep, positionOffset, edgeGeometry, vertexPositions, occBrep: serializedOccBrep, faceGeometry };
}

export interface FilletResult {
  brep: Brep;
  positionOffset: { x: number; y: number; z: number };
  edgeGeometry?: THREE.BufferGeometry;
  vertexPositions?: Float32Array;
  occBrep?: string;
  faceGeometry?: THREE.BufferGeometry;
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
  const ocService = OpenCascadeService.getInstance();

  // Convert to OCC shape at world position (with rotation if present)
  const shape = await buildWorldShape(ocService, brep, position, occBrep, rotation);

  // Apply fillet — skip redundant ShapeFix when shape comes from deserialized occBrep
  const resultShape = await ocService.filletEdges(shape, edgeIndices, radius, !!occBrep);

  return postProcessResult(ocService, resultShape, position, rotation);
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
  const ocService = OpenCascadeService.getInstance();

  // Convert to OCC shape at world position (with rotation if present)
  const shape = await buildWorldShape(ocService, brep, position, occBrep, rotation);

  // Apply chamfer — skip redundant ShapeFix when shape comes from deserialized occBrep
  const resultShape = await ocService.chamferEdges(shape, edgeIndices, distance, !!occBrep);

  return postProcessResult(ocService, resultShape, position, rotation);
}
