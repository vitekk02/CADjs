import * as THREE from "three";
import { Brep, CompoundBrep, Edge, Face, Vertex } from "./geometry";

export function createGeometryFromBRep(faces: Face[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  faces.forEach((face) => {
    const verts = face.vertices;
    // Use the face normal for all triangles in the face.
    const normal = face.normal;
    // Triangulate the face (assumes convex polygon)
    for (let i = 1; i < verts.length - 1; i++) {
      // Triangle vertices: verts[0], verts[i], verts[i+1]
      positions.push(verts[0].x, verts[0].y, verts[0].z);
      positions.push(verts[i].x, verts[i].y, verts[i].z);
      positions.push(verts[i + 1].x, verts[i + 1].y, verts[i + 1].z);

      // For each vertex, add the same normal.
      normals.push(normal.x, normal.y, normal.z);
      normals.push(normal.x, normal.y, normal.z);
      normals.push(normal.x, normal.y, normal.z);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

// Modified to account for element positions
export function unionBrepCompound(
  brep1: Brep,
  brep2: Brep,
  pos1?: THREE.Vector3,
  pos2?: THREE.Vector3,
  targetPos?: THREE.Vector3
): CompoundBrep {
  const children: Brep[] = [];

  // Create adjusted copies of the breps with transformed vertices
  const adjustedBrep1 = transformBrepVertices(brep1, pos1, targetPos);
  const adjustedBrep2 = transformBrepVertices(brep2, pos2, targetPos);

  // Now add the transformed breps
  if (
    "children" in adjustedBrep1 &&
    Array.isArray((adjustedBrep1 as any).children)
  ) {
    children.push(...(adjustedBrep1 as CompoundBrep).children);
  } else {
    children.push(adjustedBrep1);
  }

  if (
    "children" in adjustedBrep2 &&
    Array.isArray((adjustedBrep2 as any).children)
  ) {
    children.push(...(adjustedBrep2 as CompoundBrep).children);
  } else {
    children.push(adjustedBrep2);
  }

  return new CompoundBrep(children);
}
// Helper function to transform brep vertices based on position
export function transformBrepVertices(
  brep: Brep,
  sourcePos?: THREE.Vector3,
  targetPos?: THREE.Vector3
): Brep {
  // If no positions provided or they're the same, return the original
  if (!sourcePos || !targetPos || sourcePos.equals(targetPos)) {
    return brep;
  }

  // For compound breps, transform each child
  if ("children" in brep && Array.isArray((brep as any).children)) {
    const compoundBrep = brep as unknown as CompoundBrep;
    return new CompoundBrep(
      compoundBrep.children.map((child) =>
        transformBrepVertices(child, sourcePos, targetPos)
      )
    );
  }

  const offset = new THREE.Vector3().subVectors(targetPos, sourcePos);

  // Clone vertices and apply transformation
  const newVertices = brep.vertices.map(
    (v) => new Vertex(v.x + offset.x, v.y + offset.y, v.z + offset.z)
  );

  // Create edges with transformed vertices
  const newEdges = brep.edges.map((edge) => {
    const startIndex = brep.vertices.findIndex((v) => v.equals(edge.start));
    const endIndex = brep.vertices.findIndex((v) => v.equals(edge.end));

    if (startIndex === -1 || endIndex === -1) {
      console.error("Could not find vertex in BREP", edge.start, edge.end);
      return new Edge(newVertices[0], newVertices[0]);
    }

    return new Edge(newVertices[startIndex], newVertices[endIndex]);
  });

  // Create faces with transformed vertices
  const newFaces = brep.faces.map((face) => {
    const faceVertices = face.vertices.map((v) => {
      const index = brep.vertices.findIndex((vertex) => vertex.equals(v));
      if (index === -1) {
        console.error("Could not find face vertex in BREP", v);
        return newVertices[0];
      }
      return newVertices[index];
    });
    return new Face(faceVertices);
  });

  return new Brep(newVertices, newEdges, newFaces);
}
