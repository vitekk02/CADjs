// src/scene-operations/mesh-operations.ts
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Brep, CompoundBrep, Face } from "../geometry";
import { createGeometryFromBRep } from "../convertBRepToGeometry";
import { BODY, SWEEP } from "../theme";

/** Get current window resolution for LineMaterial, with fallback for non-browser environments */
function getResolution(): THREE.Vector2 {
  const w = typeof window !== "undefined" ? window.innerWidth : 1920;
  const h = typeof window !== "undefined" ? window.innerHeight : 1080;
  return new THREE.Vector2(w, h);
}

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
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(edges.attributes.position.array as Float32Array);
    const edgeMaterial = new LineMaterial({
      color: BODY.edge,
      linewidth: BODY.edgeWidth,
      resolution: getResolution(),
    });
    const edgeLines = new LineSegments2(lineGeo, edgeMaterial);
    edgeLines.userData.isEdgeOverlay = true;
    group.add(edgeLines);
    edges.dispose();

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

  const edgeMat = new LineMaterial({
    color: BODY.edge,
    linewidth: BODY.edgeWidth,
    resolution: getResolution(),
  });

  if (edgeGeometry) {
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(edgeGeometry.attributes.position.array as Float32Array);
    const edgeLines = new LineSegments2(lineGeo, edgeMat);
    edgeLines.userData.isEdgeOverlay = true;
    group.add(edgeLines);
  } else {
    const edges = new THREE.EdgesGeometry(geometry, 30);
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(edges.attributes.position.array as Float32Array);
    const edgeLines = new LineSegments2(lineGeo, edgeMat);
    edgeLines.userData.isEdgeOverlay = true;
    group.add(edgeLines);
    edges.dispose();
  }

  return group;
}

/**
 * Create a Three.js Group for a path element (open wire with no faces).
 * Renders as a line with point markers.
 */
export function createMeshFromPath(
  points: { x: number; y: number; z: number }[],
): THREE.Group {
  const group = new THREE.Group();

  if (points.length < 2) return group;

  // Create line geometry from path points
  const linePoints = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: SWEEP.pathPreview,
    linewidth: 2,
  });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.userData.isPathLine = true;
  group.add(line);

  // Create point markers at each vertex
  const pointGroup = new THREE.Group();
  pointGroup.userData.isHelper = true;
  const sphereGeometry = new THREE.SphereGeometry(0.06, 8, 8);
  const sphereMaterial = new THREE.MeshBasicMaterial({ color: SWEEP.pathPoint });

  for (const pt of points) {
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(pt.x, pt.y, pt.z);
    pointGroup.add(sphere);
  }
  group.add(pointGroup);

  return group;
}

/**
 * Recursively dispose all GPU resources (geometries + materials) on an Object3D tree.
 * Call after removing an object from the scene to prevent memory leaks.
 */
export function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if ((child as any).geometry) {
      (child as any).geometry.dispose();
    }
    if ((child as any).material) {
      const material = (child as any).material;
      if (Array.isArray(material)) {
        material.forEach((m: THREE.Material) => m.dispose());
      } else {
        (material as THREE.Material).dispose();
      }
    }
  });
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

/** Find the first child Mesh inside a Group returned by createMeshFromBrep.
 *  Skips LineSegments2 (edge overlays) which also extend THREE.Mesh. */
export function findChildMesh(obj: THREE.Object3D): THREE.Mesh | null {
  if (obj instanceof THREE.Mesh && !obj.userData.isEdgeOverlay) return obj;
  let found: THREE.Mesh | null = null;
  obj.traverse((child) => {
    if (!found && child instanceof THREE.Mesh && !child.userData.isEdgeOverlay) {
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
