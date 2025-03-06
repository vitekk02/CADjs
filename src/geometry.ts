export class Vertex {
  constructor(public x: number, public y: number, public z: number) {}

  // Compare two vertices with a tolerance for floating point errors.
  equals(other: Vertex, tolerance = 1e-6): boolean {
    return (
      Math.abs(this.x - other.x) < tolerance &&
      Math.abs(this.y - other.y) < tolerance &&
      Math.abs(this.z - other.z) < tolerance
    );
  }
}

export class Edge {
  constructor(public start: Vertex, public end: Vertex) {}

  // Get a vector representing the edge direction.
  get direction(): Vertex {
    return new Vertex(
      this.end.x - this.start.x,
      this.end.y - this.start.y,
      this.end.z - this.start.z
    );
  }

  // Example: Compute the length of the edge.
  get length(): number {
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const dz = this.end.z - this.start.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

export class Face {
  constructor(public vertices: Vertex[]) {
    if (vertices.length < 3) {
      throw new Error("A face must have at least three vertices.");
    }
  }

  // Compute the normal vector of the face assuming it is planar.
  get normal(): Vertex {
    const v0 = this.vertices[0];
    const v1 = this.vertices[1];
    const v2 = this.vertices[2];

    const a = new Vertex(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
    const b = new Vertex(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
    return crossProduct(a, b);
  }
}

export class Brep {
  vertices: Vertex[];
  edges: Edge[];
  faces: Face[];

  constructor(vertices: Vertex[], edges: Edge[], faces: Face[]) {
    this.vertices = vertices;
    this.edges = edges;
    this.faces = faces;
  }
}

export class CompoundBrep extends Brep {
  children: Brep[];
  constructor(children: Brep[]) {
    // We don't compute new vertices/edges/faces here;
    // we simply record the children.
    super([], [], []);
    this.children = children;
  }
}

export interface BrepConnection {
  targetId: string;
  connectionType: "union" | "assembly";
}

export interface BrepNode {
  id: string;
  brep: Brep;
  // Reference to the mesh in the scene.
  mesh: any;
  connections: BrepConnection[];
}

export class BrepGraph {
  nodes: Map<string, BrepNode> = new Map();

  addNode(node: BrepNode) {
    this.nodes.set(node.id, node);
  }

  addConnection(sourceId: string, connection: BrepConnection) {
    const node = this.nodes.get(sourceId);
    if (node) {
      node.connections.push(connection);
    }
  }
}
// Helper function to compute the cross product of two vectors.
function crossProduct(a: Vertex, b: Vertex): Vertex {
  return new Vertex(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}
