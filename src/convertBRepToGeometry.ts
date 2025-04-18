import * as THREE from "three";
import { Brep, CompoundBrep, Edge, Face, Vertex } from "./geometry";
import { createMeshFromBrep } from "./scene-operations";

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
  targetPos?: THREE.Vector3,
  scaleMatrix?: THREE.Matrix4
): Brep {
  // If no positions provided or they're the same, return the original
  if (
    (!sourcePos || !targetPos || sourcePos.equals(targetPos)) &&
    !scaleMatrix
  ) {
    return brep;
  }

  // For compound breps, transform each child
  if ("children" in brep && Array.isArray((brep as any).children)) {
    const compoundBrep = brep as unknown as CompoundBrep;
    return new CompoundBrep(
      compoundBrep.children.map((child) =>
        transformBrepVertices(child, sourcePos, targetPos, scaleMatrix)
      )
    );
  }

  const offset =
    sourcePos && targetPos
      ? new THREE.Vector3().subVectors(targetPos, sourcePos)
      : new THREE.Vector3(0, 0, 0);

  // Clone vertices and apply transformation
  const newVertices = brep.vertices.map((v) => {
    // Create a Vector3 for the vertex
    const vertex = new THREE.Vector3(v.x, v.y, v.z);

    // Apply scaling if provided
    if (scaleMatrix) {
      vertex.applyMatrix4(scaleMatrix);
    }

    // Apply translation
    vertex.add(offset);

    return new Vertex(vertex.x, vertex.y, vertex.z);
  });

  // Create edges with transformed vertices using tolerance-based matching
  const newEdges = brep.edges.map((edge) => {
    // Use tolerance-based vertex finding
    const startIndex = findVertexIndexWithTolerance(brep.vertices, edge.start);
    const endIndex = findVertexIndexWithTolerance(brep.vertices, edge.end);

    if (startIndex === -1 || endIndex === -1) {
      console.error("Could not find vertex in BREP", edge.start, edge.end);
      return new Edge(newVertices[0], newVertices[0]);
    }

    return new Edge(newVertices[startIndex], newVertices[endIndex]);
  });

  // Create faces with transformed vertices
  const newFaces = brep.faces.map((face) => {
    const faceVertices = face.vertices.map((v) => {
      // Use tolerance-based vertex finding
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

// Add this helper function for tolerance-based vertex matching
function findVertexIndexWithTolerance(
  vertices: Vertex[],
  target: Vertex,
  tolerance: number = 1e-6
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
  tolerance: number = 1e-6
): boolean {
  return (
    Math.abs(v1.x - v2.x) < tolerance &&
    Math.abs(v1.y - v2.y) < tolerance &&
    Math.abs(v1.z - v2.z) < tolerance
  );
}

export async function createMeshFromCompoundBrep(
  compoundBrep: CompoundBrep,
  material?: THREE.Material
): Promise<THREE.Mesh> {
  // Default material
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide,
    });
  }

  try {
    // Get the unified representation using OpenCascade
    const unifiedBrep = await compoundBrep.getUnifiedBRep();

    // Create a mesh from the unified BRep
    return createMeshFromBrep(unifiedBrep);
  } catch (error) {
    console.error("Error creating mesh from compound BRep:", error);

    // Fallback - use the original implementation
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
