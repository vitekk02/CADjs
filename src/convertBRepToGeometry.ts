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

export function unionBrepCompound(brep1: Brep, brep2: Brep): CompoundBrep {
  return new CompoundBrep([brep1, brep2]);
}
