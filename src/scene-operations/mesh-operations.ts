// src/scene-operations/mesh-operations.ts
import * as THREE from "three";
import { Brep, CompoundBrep, Face } from "../geometry";
import { createGeometryFromBRep } from "../convertBRepToGeometry";
import { BODY } from "../theme";

export function createMeshFromBrep(brep: Brep): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: BODY.default,
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0.2,
  });

  const faces = getAllFaces(brep);
  if (faces.length > 0) {
    const geometry = createGeometryFromBRep(faces);
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    // Add visible edge lines (dark outlines like Fusion 360)
    const edges = new THREE.EdgesGeometry(geometry, 15);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: BODY.edge,
      linewidth: 1,
    });
    const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
    edgeLines.userData.isEdgeOverlay = true;
    group.add(edgeLines);

    return group;
  } else {
    console.error("Invalid BREP structure:", brep);
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const errorMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(geometry, errorMaterial));
    return group;
  }
}

export function getAllFaces(brep: Brep): Face[] {
  if ("children" in brep && Array.isArray((brep as any).children)) {
    const compoundBrep = brep as unknown as CompoundBrep;

    const unifiedBrep = (compoundBrep as any)._unifiedBRep as Brep | null;
    if (unifiedBrep && unifiedBrep.faces && unifiedBrep.faces.length > 0) {
      return unifiedBrep.faces;
    }

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

/** Find the first child Mesh inside a Group returned by createMeshFromBrep */
export function findChildMesh(obj: THREE.Object3D): THREE.Mesh | null {
  if (obj instanceof THREE.Mesh) return obj;
  let found: THREE.Mesh | null = null;
  obj.traverse((child) => {
    if (!found && child instanceof THREE.Mesh) {
      found = child;
    }
  });
  return found;
}

export function getObject(
  objectsMap: Map<string, THREE.Object3D>,
  nodeId: string,
): THREE.Object3D | undefined {
  return objectsMap.get(nodeId);
}

export function getAllObjects(
  objectsMap: Map<string, THREE.Object3D>,
): Map<string, THREE.Object3D> {
  return objectsMap;
}
