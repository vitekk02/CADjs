import { Brep, Edge, Face, Vertex } from "../../geometry";
import * as THREE from "three";

export function createTriangleBRep(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3
): Brep {
  // Create vertices
  const v1 = new Vertex(p1.x, p1.y, p1.z);
  const v2 = new Vertex(p2.x, p2.y, p2.z);
  const v3 = new Vertex(p3.x, p3.y, p3.z);

  // Create edges
  const e1 = new Edge(v1, v2);
  const e2 = new Edge(v2, v3);
  const e3 = new Edge(v3, v1);

  // Create face
  const face = new Face([v1, v2, v3]);

  // Create and return the B-rep
  return new Brep([v1, v2, v3], [e1, e2, e3], [face]);
}

export function createEquilateralTriangle(
  center: THREE.Vector3,
  size: number
): Brep {
  // Create an equilateral triangle centered at the given point
  const halfSize = size / 2;
  const height = (size * Math.sqrt(3)) / 2;

  const p1 = new THREE.Vector3(
    center.x - halfSize,
    center.y - height / 3,
    center.z
  );
  const p2 = new THREE.Vector3(
    center.x + halfSize,
    center.y - height / 3,
    center.z
  );
  const p3 = new THREE.Vector3(center.x, center.y + (2 * height) / 3, center.z);

  return createTriangleBRep(p1, p2, p3);
}
