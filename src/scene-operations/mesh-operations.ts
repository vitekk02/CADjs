// src/scene-operations/mesh-operations.ts
import * as THREE from "three";
import { Brep, CompoundBrep, Face } from "../geometry";
import { createGeometryFromBRep } from "../convertBRepToGeometry";

export function createMeshFromBrep(brep: Brep): THREE.Mesh {
  let geometry;
  const material = new THREE.MeshStandardMaterial({
    color: 0x0000ff,
    side: THREE.DoubleSide,
  });

  const faces = getAllFaces(brep);
  if (faces.length > 0) {
    geometry = createGeometryFromBRep(faces);
    return new THREE.Mesh(geometry, material);
  } else {
    console.error("Invalid BREP structure:", brep);
    geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const errorMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geometry, errorMaterial);
  }
}

export function getAllFaces(brep: Brep): Face[] {
  if ("children" in brep && Array.isArray((brep as any).children)) {
    const compoundBrep = brep as unknown as CompoundBrep;
    const allFaces: Face[] = [];
    compoundBrep.children.forEach((child) => {
      allFaces.push(...getAllFaces(child));
    });
    return allFaces;
  } else if (brep.faces && brep.faces.length > 0) {
    return brep.faces;
  }
  return [];
}

export function getObject(
  objectsMap: Map<string, THREE.Object3D>,
  nodeId: string
): THREE.Object3D | undefined {
  return objectsMap.get(nodeId);
}

export function getAllObjects(
  objectsMap: Map<string, THREE.Object3D>
): Map<string, THREE.Object3D> {
  return objectsMap;
}
