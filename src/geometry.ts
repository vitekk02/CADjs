import { OpenCascadeService } from "./services/OpenCascadeService";
export class Vertex {
  constructor(
    public x: number,
    public y: number,
    public z: number
  ) {}

  equals(other: Vertex, tolerance: number = 0): boolean {
    if (tolerance === 0) {
      return this.x === other.x && this.y === other.y && this.z === other.z;
    } else {
      return (
        Math.abs(this.x - other.x) < tolerance &&
        Math.abs(this.y - other.y) < tolerance &&
        Math.abs(this.z - other.z) < tolerance
      );
    }
  }
}

export class Edge {
  constructor(
    public start: Vertex,
    public end: Vertex
  ) {}

  get direction(): Vertex {
    return new Vertex(
      this.end.x - this.start.x,
      this.end.y - this.start.y,
      this.end.z - this.start.z
    );
  }

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

  // normal via cross product
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

  setUnifiedBrep(brep: Brep) {
    this._unifiedBRep = brep;
  }

  // lazy load - computes unified brep only when needed
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
      const ocService = OpenCascadeService.getInstance();
      const oc = await ocService.getOC();

      let resultShape = await ocService.brepToOCShape(this.children[0]);
      const progressRange = new oc.Message_ProgressRange_1();

      // fuse all children together
      for (let i = 1; i < this.children.length; i++) {
        const nextShape = await ocService.brepToOCShape(this.children[i]);
        const fusionOp = new oc.BRepAlgoAPI_Fuse_3(resultShape, nextShape, progressRange);
        await ocService.runOperation(fusionOp);

        if (fusionOp.IsDone()) {
          resultShape = fusionOp.Shape();
        } else {
          console.error("Boolean fusion operation failed");
        }
      }

      this._unifiedBRep = await ocService.ocShapeToBRep(resultShape);

      return this._unifiedBRep;
    } catch (error) {
      console.error("Error in OpenCascade union operation:", error);
      return this.children[0];
    }
  }
}
export interface BrepConnection {
  targetId: string;
  connectionType: "union" | "difference" | "intersection" | "assembly" | "ungroup";
}

export interface BrepNode {
  id: string;
  brep: Brep;
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

function crossProduct(a: Vertex, b: Vertex): Vertex {
  return new Vertex(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}
