// src/scene-operations/mesh-operations.ts
import * as THREE from "three";
import { Brep, CompoundBrep, Face } from "../geometry";
import { createGeometryFromBRep } from "../convertBRepToGeometry";
function createEdgeGeometry(brep: Brep): THREE.BufferGeometry {
  const positions: number[] = [];

  // For a CompoundBrep, collect edges from all children
  if ("children" in brep && Array.isArray((brep as any).children)) {
    const compoundBrep = brep as unknown as CompoundBrep;
    compoundBrep.children.forEach((child) => {
      // For each child BREP, add its edges
      if (child.edges && child.edges.length > 0) {
        child.edges.forEach((edge) => {
          positions.push(
            edge.start.x,
            edge.start.y,
            edge.start.z,
            edge.end.x,
            edge.end.y,
            edge.end.z
          );
        });
      }
    });
  }
  // For a regular BREP, just use its edges
  else if (brep.edges && brep.edges.length > 0) {
    brep.edges.forEach((edge) => {
      positions.push(
        edge.start.x,
        edge.start.y,
        edge.start.z,
        edge.end.x,
        edge.end.y,
        edge.end.z
      );
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return geometry;
}
export function createMeshFromBrep(brep: Brep): THREE.Group {
  // Create the main mesh as before
  const geometry = createGeometryFromBRep(brep.faces);
  const material = new THREE.MeshStandardMaterial({
    color: 0x0000ff,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);

  // Create a group to hold both the mesh and wireframes
  const group = new THREE.Group();
  group.add(mesh);

  // Create edge wireframe
  const edgeGeometry = createEdgeGeometry(brep);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.renderOrder = 999;
  edges.visible = false; // Hidden by default
  edges.userData.isWireframe = true;
  group.add(edges);

  // Create vertex points
  const vertexGroup = new THREE.Group();
  brep.vertices.forEach((vertex) => {
    const sphereGeometry = new THREE.SphereGeometry(0.05, 16, 16);
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      depthTest: false,
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(
      vertex.x - brep.vertices[0].x,
      vertex.y - brep.vertices[0].y,
      vertex.z - brep.vertices[0].z
    );
    vertexGroup.visible = false; // Hidden by default
    sphere.renderOrder = 1000;
    vertexGroup.add(sphere);
  });
  vertexGroup.userData.isWireframe = true;
  group.add(vertexGroup);

  return group;
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
