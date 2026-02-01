import * as THREE from "three";
import { Brep, CompoundBrep, Edge, Face, Vertex } from "./geometry";
import { createMeshFromBrep } from "./scene-operations";

export function createGeometryFromBRep(faces: Face[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  const allYValues = new Set<string>();
  faces.forEach((face) => {
    face.vertices.forEach((v) => allYValues.add(v.y.toFixed(3)));
  });

  faces.forEach((face, faceIndex) => {
    const verts = face.vertices;
    const normal = face.normal;

    if (verts.length < 3) {
      return;
    }

    // triangulate (assumes convex polygon)
    for (let i = 1; i < verts.length - 1; i++) {
      positions.push(verts[0].x, verts[0].y, verts[0].z);
      positions.push(verts[i].x, verts[i].y, verts[i].z);
      positions.push(verts[i + 1].x, verts[i + 1].y, verts[i + 1].z);

      normals.push(normal.x, normal.y, normal.z);
      normals.push(normal.x, normal.y, normal.z);
      normals.push(normal.x, normal.y, normal.z);
    }
  });

  for (let t = 0; t < 3 && t * 9 < positions.length; t++) {
    const base = t * 9;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

export function unionBrepCompound(
  brep1: Brep,
  brep2: Brep,
  pos1?: THREE.Vector3,
  pos2?: THREE.Vector3,
  targetPos?: THREE.Vector3,
): CompoundBrep {
  const children: Brep[] = [];

  const adjustedBrep1 = transformBrepVertices(brep1, pos1, targetPos);
  const adjustedBrep2 = transformBrepVertices(brep2, pos2, targetPos);

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

export function transformBrepVertices(
  brep: Brep,
  sourcePos?: THREE.Vector3,
  targetPos?: THREE.Vector3,
  scaleMatrix?: THREE.Matrix4,
): Brep {
  if (
    (!sourcePos || !targetPos || sourcePos.equals(targetPos)) &&
    !scaleMatrix
  ) {
    return brep;
  }

  if ("children" in brep && Array.isArray((brep as any).children)) {
    const compoundBrep = brep as unknown as CompoundBrep;
    return new CompoundBrep(
      compoundBrep.children.map((child) =>
        transformBrepVertices(child, sourcePos, targetPos, scaleMatrix),
      ),
    );
  }

  const offset =
    sourcePos && targetPos
      ? new THREE.Vector3().subVectors(targetPos, sourcePos)
      : new THREE.Vector3(0, 0, 0);

  const newVertices = brep.vertices.map((v) => {
    const vertex = new THREE.Vector3(v.x, v.y, v.z);

    if (scaleMatrix) {
      vertex.applyMatrix4(scaleMatrix);
    }

    vertex.add(offset);

    return new Vertex(vertex.x, vertex.y, vertex.z);
  });

  const newEdges = brep.edges.map((edge) => {
    const startIndex = findVertexIndexWithTolerance(brep.vertices, edge.start);
    const endIndex = findVertexIndexWithTolerance(brep.vertices, edge.end);

    if (startIndex === -1 || endIndex === -1) {
      console.error("Could not find vertex in BREP", edge.start, edge.end);
      return new Edge(newVertices[0], newVertices[0]);
    }

    return new Edge(newVertices[startIndex], newVertices[endIndex]);
  });

  const newFaces = brep.faces.map((face) => {
    const faceVertices = face.vertices.map((v) => {
      const index = findVertexIndexWithTolerance(brep.vertices, v);
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

function findVertexIndexWithTolerance(
  vertices: Vertex[],
  target: Vertex,
  tolerance: number = 1e-6,
): number {
  for (let i = 0; i < vertices.length; i++) {
    if (vertexEqualsWithTolerance(vertices[i], target, tolerance)) {
      return i;
    }
  }
  return -1;
}

function vertexEqualsWithTolerance(
  v1: Vertex,
  v2: Vertex,
  tolerance: number = 1e-6,
): boolean {
  return (
    Math.abs(v1.x - v2.x) < tolerance &&
    Math.abs(v1.y - v2.y) < tolerance &&
    Math.abs(v1.z - v2.z) < tolerance
  );
}

export async function createMeshFromCompoundBrep(
  compoundBrep: CompoundBrep,
  material?: THREE.Material,
): Promise<THREE.Mesh> {
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide,
    });
  }

  try {
    const unifiedBrep = await compoundBrep.getUnifiedBRep();
    return createMeshFromBrep(unifiedBrep);
  } catch (error) {
    console.error("Error creating mesh from compound:", error);

    // fallback
    const allFaces: Face[] = [];
    compoundBrep.children.forEach((childBrep) => {
      if (childBrep.faces && childBrep.faces.length > 0) {
        allFaces.push(...childBrep.faces);
      }
    });

    const geometry = createGeometryFromBRep(allFaces);
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
  }
}
