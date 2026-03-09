// JSON serialization types for Web Worker communication
export interface VertexJSON { x: number; y: number; z: number }
export interface EdgeJSON { start: VertexJSON; end: VertexJSON }
export interface FaceJSON { vertices: VertexJSON[] }
export interface BrepJSON {
  type?: "brep" | "compound";
  vertices: VertexJSON[];
  edges: EdgeJSON[];
  faces: FaceJSON[];
}
export interface CompoundBrepJSON extends BrepJSON {
  type: "compound";
  children: BrepJSON[];
  unifiedBRep?: BrepJSON;
}

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

  toJSON(): BrepJSON {
    return {
      type: "brep",
      vertices: this.vertices.map(v => ({ x: v.x, y: v.y, z: v.z })),
      edges: this.edges.map(e => ({
        start: { x: e.start.x, y: e.start.y, z: e.start.z },
        end: { x: e.end.x, y: e.end.y, z: e.end.z },
      })),
      faces: this.faces.map(f => ({
        vertices: f.vertices.map(v => ({ x: v.x, y: v.y, z: v.z })),
      })),
    };
  }

  static fromJSON(json: BrepJSON): Brep {
    const vertices = json.vertices.map(v => new Vertex(v.x, v.y, v.z));
    const edges = json.edges.map(e => new Edge(
      new Vertex(e.start.x, e.start.y, e.start.z),
      new Vertex(e.end.x, e.end.y, e.end.z),
    ));
    const faces = json.faces.map(f => new Face(
      f.vertices.map(v => new Vertex(v.x, v.y, v.z)),
    ));
    return new Brep(vertices, edges, faces);
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
      // Route through worker client (lazy import to avoid circular dependency)
      const { OccWorkerClient } = await import("./services/OccWorkerClient");
      const client = OccWorkerClient.getInstance();
      const result = await client.send<{ brepJson: BrepJSON }>({
        type: "unifyCompound",
        payload: {
          childrenBrepJson: this.children.map(c => c.toJSON()),
        },
      });
      this._unifiedBRep = Brep.fromJSON(result.brepJson);
      return this._unifiedBRep;
    } catch (error) {
      console.error("Error in compound unification:", error);
      throw new Error(`Compound unification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  toJSON(): CompoundBrepJSON {
    return {
      type: "compound",
      vertices: [],
      edges: [],
      faces: [],
      children: this.children.map(c => c.toJSON() as BrepJSON),
      unifiedBRep: this._unifiedBRep?.toJSON() as BrepJSON | undefined,
    };
  }

  static fromJSON(json: CompoundBrepJSON): CompoundBrep {
    const children = json.children.map(c => Brep.fromJSON(c));
    const compound = new CompoundBrep(children);
    if (json.unifiedBRep) {
      compound.setUnifiedBrep(Brep.fromJSON(json.unifiedBRep));
    }
    return compound;
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

/**
 * Deep-clone a Brep or CompoundBrep.
 * BRep refs are treated as immutable in the codebase, but we clone
 * the vertex/edge/face arrays so the copy is truly independent.
 */
export function cloneBrep(brep: Brep): Brep {
  if (brep instanceof CompoundBrep) {
    const clonedChildren = brep.children.map(child => cloneBrep(child));
    const compound = new CompoundBrep(clonedChildren);
    // Clone unified brep if already computed
    const unified = (brep as any)._unifiedBRep as Brep | null;
    if (unified) {
      compound.setUnifiedBrep(cloneBrep(unified));
    }
    return compound;
  }

  const vertices = brep.vertices.map(v => new Vertex(v.x, v.y, v.z));
  const edges = brep.edges.map(e => new Edge(
    new Vertex(e.start.x, e.start.y, e.start.z),
    new Vertex(e.end.x, e.end.y, e.end.z),
  ));
  const faces = brep.faces.map(f => new Face(
    f.vertices.map(v => new Vertex(v.x, v.y, v.z)),
  ));
  return new Brep(vertices, edges, faces);
}

function crossProduct(a: Vertex, b: Vertex): Vertex {
  return new Vertex(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}
