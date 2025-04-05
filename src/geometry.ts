import { OpenCascadeService } from "./services/OpenCascadeService";

export class Vertex {
  constructor(
    public x: number,
    public y: number,
    public z: number
  ) {}

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
  constructor(
    public start: Vertex,
    public end: Vertex
  ) {}

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
  private _unifiedBRep: Brep | null = null;

  constructor(children: Brep[]) {
    super([], [], []);
    this.children = children;
  }

  // Setter for the unified BRep
  setUnifiedBrep(brep: Brep) {
    this._unifiedBRep = brep;
  }

  // Lazy-load the unified BRep when needed
  async getUnifiedBRep(): Promise<Brep> {
    if (this._unifiedBRep) {
      return this._unifiedBRep;
    }

    if (this.children.length === 0) {
      return new Brep([], [], []);
    }

    if (this.children.length === 1) {
      return this.children[0];
    }

    try {
      // Use OpenCascade for unification
      const ocService = OpenCascadeService.getInstance();
      const oc = await ocService.getOC();

      // Convert first child to OC shape
      let resultShape = await ocService.brepToOCShape(this.children[0]);

      // Union with each subsequent shape
      for (let i = 1; i < this.children.length; i++) {
        const nextShape = await ocService.brepToOCShape(this.children[i]);
        const fusionOp = new oc.BRepAlgoAPI_Fuse(resultShape, nextShape);
        await ocService.runOperation(fusionOp);

        if (fusionOp.IsDone()) {
          resultShape = fusionOp.Shape();
        } else {
          console.error("Boolean fusion operation failed");
        }
      }

      // Convert the final shape back to our BRep format
      this._unifiedBRep = await ocService.ocShapeToBRep(resultShape);

      return this._unifiedBRep;
    } catch (error) {
      console.error("Error in OpenCascade union operation:", error);
      // Fallback: return first child
      return this.children[0];
    }
  }
}
export interface BrepConnection {
  targetId: string;
  connectionType: "union" | "assembly" | "ungroup";
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
