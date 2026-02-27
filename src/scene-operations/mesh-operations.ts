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

/**
 * Create a Three.js Group from pre-built BufferGeometry (e.g. from OCC direct tessellation).
 * Produces the same Group structure as createMeshFromBrep: Mesh + edge overlay LineSegments.
 * If edgeGeometry is provided (from OCC topological edges), it is used for the edge overlay;
 * otherwise falls back to EdgesGeometry with a 30° threshold.
 */
export function createMeshFromGeometry(
  geometry: THREE.BufferGeometry,
  edgeGeometry?: THREE.BufferGeometry,
): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: BODY.default,
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0.2,
  });

  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: BODY.edge,
    linewidth: 1,
  });

  if (edgeGeometry) {
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeLines.userData.isEdgeOverlay = true;
    group.add(edgeLines);
  } else {
    const edges = new THREE.EdgesGeometry(geometry, 30);
    const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
    edgeLines.userData.isEdgeOverlay = true;
    group.add(edgeLines);
  }

  return group;
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

/**
 * Check if a Three.js object is a descendant (child, grandchild, etc.) of another object.
 * Walks up the parent chain from child to see if it reaches parent.
 */
export function isDescendantOf(child: THREE.Object3D, parent: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = child;
  while (current) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
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

/**
 * Collect only the pickable Mesh children from scene elements,
 * skipping edge overlays and helpers that inflate the hit area.
 * The Raycaster's default Line.threshold (1 world unit) makes
 * LineSegments (EdgesGeometry) hit-test far beyond the visible body.
 * By returning only Mesh leaves we avoid that inflation.
 */
export function collectPickableMeshes(
  elements: { nodeId: string }[],
  getObject: (nodeId: string) => THREE.Object3D | undefined,
): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  elements.forEach((el) => {
    const obj = getObject(el.nodeId);
    if (obj) {
      obj.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          !child.userData.isEdgeOverlay &&
          !child.userData.isHelper
        ) {
          meshes.push(child);
        }
      });
    }
  });
  return meshes;
}
