import { Brep, Edge, Face, Vertex } from "../../geometry";
import * as THREE from "three";

export function createCircleBRep(
  center: THREE.Vector3,
  radius: number,
  segments: number = 32
): Brep {
  // Create vertices around the circle
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    const z = center.z;

    vertices.push(new Vertex(x, y, z));
  }

  // Create edges connecting the vertices
  for (let i = 0; i < segments; i++) {
    const nextIdx = (i + 1) % segments;
    edges.push(new Edge(vertices[i], vertices[nextIdx]));
  }

  // Create the face using all vertices
  const face = new Face(vertices);

  // Create and return the B-rep
  return new Brep(vertices, edges, [face]);
}
