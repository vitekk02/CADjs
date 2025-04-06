// src/services/OpenCascadeService.ts
import type {
  gp_Pnt_3,
  OpenCascadeInstance,
  TopoDS_Shape,
} from "opencascade.js";
import { Brep, CompoundBrep, Edge, Face, Vertex } from "../geometry";
import * as THREE from "three";
import opencascade from "opencascade.js/dist/opencascade.full.js";
import opencascadeWasm from "opencascade.js/dist/opencascade.full.wasm?url";
import { transformBrepVertices } from "../convertBRepToGeometry";

const initOpenCascade = async () => {
  try {
    const oc = await opencascade({
      locateFile: () => opencascadeWasm,
    });

    return oc;
  } catch (error) {
    console.error("Failed to import opencascade.js:", error);
    throw error;
  }
};

function findConstructors(oc: any, className: string) {
  return Object.keys(oc)
    .filter((key) => key.startsWith(className))
    .map((key) => {
      // Get parameter count if available (shown in function toString)
      let paramInfo = "unknown params";
      try {
        const funcStr = oc[key].toString();
        const paramMatch = funcStr.match(/function\s*\(([^)]*)\)/);
        if (paramMatch) {
          paramInfo = paramMatch[1]
            ? paramMatch[1].split(",").length + " params"
            : "no params";
        }
      } catch (e) {}

      return {
        name: key,
        paramInfo,
      };
    });
}

export class OpenCascadeService {
  private static instance: OpenCascadeService;
  private oc: OpenCascadeInstance | null = null;
  private initPromise: Promise<OpenCascadeInstance> | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): OpenCascadeService {
    if (!OpenCascadeService.instance) {
      OpenCascadeService.instance = new OpenCascadeService();
    }
    return OpenCascadeService.instance;
  }

  async getOC(): Promise<OpenCascadeInstance> {
    if (this.oc) {
      return this.oc;
    }

    if (!this.initPromise) {
      console.log("Initializing OpenCascade.js...");
      this.initPromise = initOpenCascade();
    }

    try {
      this.oc = await this.initPromise;
      console.log("Vectors available:", findConstructors(this.oc, "gp_Vec"));
      console.log("Points available:", findConstructors(this.oc, "gp_Pnt"));
      console.log(
        "Shapes available:",
        findConstructors(this.oc, "TopoDS_Shape")
      );
      console.log(
        "Edges available:",
        findConstructors(this.oc, "BRepBuilderAPI_MakeEdge")
      );
      console.log(
        "Faces available:",
        findConstructors(this.oc, "BRepBuilderAPI_MakeFace")
      );
      console.log(
        "Wires available:",
        findConstructors(this.oc, "BRepBuilderAPI_MakeWire")
      );
      console.log(
        "Boolean operations available:",
        findConstructors(this.oc, "BRepAlgoAPI_Fuse")
      );
      console.log("Trsf constructors:", findConstructors(this.oc, "gp_Trsf"));
      console.log(
        "Sphere constructors:",
        findConstructors(this.oc, "BRepPrimAPI_MakeSphere")
      );

      console.log("OpenCascade.js initialized successfully");
      return this.oc;
    } catch (error) {
      console.error("Error initializing OpenCascade.js:", error);
      throw error;
    }
  }

  private calculateBrepBounds(brep: Brep): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  } {
    // Initialize with extreme values
    const bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };

    // Process compound BReps recursively
    if ("children" in brep && Array.isArray((brep as any).children)) {
      const compound = brep as CompoundBrep;
      compound.children.forEach((child) => {
        const childBounds = this.calculateBrepBounds(child);
        bounds.minX = Math.min(bounds.minX, childBounds.minX);
        bounds.maxX = Math.max(bounds.maxX, childBounds.maxX);
        bounds.minY = Math.min(bounds.minY, childBounds.minY);
        bounds.maxY = Math.max(bounds.maxY, childBounds.maxY);
        bounds.minZ = Math.min(bounds.minZ, childBounds.minZ);
        bounds.maxZ = Math.max(bounds.maxZ, childBounds.maxZ);
      });
      return bounds;
    }

    // For regular BReps, iterate through all vertices
    if (brep.vertices && brep.vertices.length > 0) {
      brep.vertices.forEach((vertex) => {
        bounds.minX = Math.min(bounds.minX, vertex.x);
        bounds.maxX = Math.max(bounds.maxX, vertex.x);
        bounds.minY = Math.min(bounds.minY, vertex.y);
        bounds.maxY = Math.max(bounds.maxY, vertex.y);
        bounds.minZ = Math.min(bounds.minZ, vertex.z);
        bounds.maxZ = Math.max(bounds.maxZ, vertex.z);
      });
    }

    return bounds;
  }

  // Convert our Brep to OpenCascade shape
  // Convert our Brep to OpenCascade shape
  async brepToOCShape(
    brep: Brep,
    position?: THREE.Vector3
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    let workingBrep = brep;

    // Only transform if position is provided
    if (position) {
      // Calculate actual center of the BRep
      const bounds = this.calculateBrepBounds(brep);
      const actualCenter = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2
      );

      // Only transform if the actual center differs from desired position
      if (!actualCenter.equals(position)) {
        console.log(
          "Transforming BRep from actual center",
          actualCenter,
          "to position",
          position
        );
        // Transform from actual center to desired position
        workingBrep = transformBrepVertices(brep, actualCenter, position);
      }
    }
    console.log("Converting BRep to OpenCascade shape:", workingBrep);
    console.log({ position });
    // Create a new shape builder
    const builder = new oc.BRep_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);

    try {
      // For each face in our BRep, create an OC face and add to compound
      for (const face of workingBrep.faces) {
        const vertices = face.vertices;
        if (vertices.length < 3) continue;

        // Create array of OC points
        const ocPoints: gp_Pnt_3[] = [];
        for (const v of vertices) {
          ocPoints.push(new oc.gp_Pnt_3(v.x, v.y, v.z));
        }

        // Create a polygon from points
        const polygonWire = this.createPolygonWire(oc, ocPoints);

        // Create a plane using the first 3 points of the face
        // This helps ensure the face is created in the correct plane
        const p1 = ocPoints[0];
        const p2 = ocPoints[1];
        const p3 = ocPoints[2];

        // Create vectors for plane definition
        const v1 = new oc.gp_Vec_4(
          p2.X() - p1.X(),
          p2.Y() - p1.Y(),
          p2.Z() - p1.Z()
        );

        const v2 = new oc.gp_Vec_4(
          p3.X() - p1.X(),
          p3.Y() - p1.Y(),
          p3.Z() - p1.Z()
        );

        // Calculate normal vector using cross product
        const normalVec = new oc.gp_Vec_1();
        normalVec.DotCross(v1, v2);

        // If normal length is too small, use XY plane as fallback
        let pln;
        if (normalVec.Magnitude() < 1e-7) {
          pln = new oc.gp_Pln_1(); // Default XY plane
        } else {
          // Create a direction from the normal vector
          const dir = new oc.gp_Dir_4(
            normalVec.X(),
            normalVec.Y(),
            normalVec.Z()
          );
          // Create a plane using a point and the normal direction
          pln = new oc.gp_Pln_3(p1, dir);
        }

        // Now create the face from the plane and wire
        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(
          polygonWire,
          true
        );

        if (faceBuilder.IsDone()) {
          const ocFace = faceBuilder.Face();
          builder.Add(compound, ocFace);
        } else {
          console.warn("Failed to create face from wire and plane");
        }

        // Clean up
        ocPoints.forEach((p) => p.delete());
        v1.delete();
        v2.delete();
        normalVec.delete();
        pln.delete();
      }

      return compound;
    } catch (error) {
      console.error("Error converting BRep to OpenCascade shape:", error);
      throw error;
    }
  }

  // Helper to create a polygonal wire from points
  private createPolygonWire(oc: OpenCascadeInstance, points: gp_Pnt_3[]) {
    if (points.length < 2) {
      throw new Error("Need at least two points for a wire");
    }

    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

    try {
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];

        const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
        if (edge.IsDone()) {
          wireBuilder.Add_1(edge.Edge());
        } else {
          console.warn("Failed to create edge");
        }
      }

      if (wireBuilder.IsDone()) {
        // Cast the Shape to a Wire explicitly
        return oc.TopoDS.Wire_1(wireBuilder.Wire());
      } else {
        throw new Error("Failed to create wire");
      }
    } catch (error) {
      console.error("Error creating polygonal wire:", error);
      throw error;
    }
  }

  // Wait for an OpenCascade operation to complete
  async runOperation(operation: any): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        // Create a progress range for the Build operation
        const oc = this.oc;
        if (!oc) throw new Error("OpenCascade not initialized");

        const progressRange = new oc.Message_ProgressRange_1();
        operation.Build(progressRange); // Pass the progress range
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Convert OpenCascade shape back to our BRep
  async ocShapeToBRep(
    shape: TopoDS_Shape,
    position?: THREE.Vector3
  ): Promise<Brep> {
    const oc = await this.getOC();

    // Create maps to store vertices and edges for deduplication
    const vertexMap = new Map<string, Vertex>();
    const edgeMap = new Map<string, Edge>();
    const faces: Face[] = [];
    const allVertices: Vertex[] = [];
    const allEdges: Edge[] = [];

    try {
      // Process edges first to extract vertices
      const edgeExplorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      );

      while (edgeExplorer.More()) {
        const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
        const curve = new oc.BRepAdaptor_Curve_2(edge);

        // Sample points along the edge
        const first = curve.FirstParameter();
        const last = curve.LastParameter();

        // Get the start and end points
        const startPnt = curve.Value(first);
        const endPnt = curve.Value(last);

        // Create vertices
        const v1 = this.getOrCreateVertex(
          vertexMap,
          startPnt.X(),
          startPnt.Y(),
          startPnt.Z(),
          allVertices
        );

        const v2 = this.getOrCreateVertex(
          vertexMap,
          endPnt.X(),
          endPnt.Y(),
          endPnt.Z(),
          allVertices
        );

        // Create edge
        const edgeKey = this.createEdgeKey(v1, v2);
        if (!edgeMap.has(edgeKey)) {
          const newEdge = new Edge(v1, v2);
          edgeMap.set(edgeKey, newEdge);
          allEdges.push(newEdge);
        }

        edgeExplorer.Next();
      }

      // Process faces
      const faceExplorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      );

      while (faceExplorer.More()) {
        const face = oc.TopoDS.Face_1(faceExplorer.Current());

        // Get the wireframe of the face
        const wireExplorer = new oc.TopExp_Explorer_2(
          face,
          oc.TopAbs_ShapeEnum.TopAbs_WIRE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        );

        if (wireExplorer.More()) {
          const wire = oc.TopoDS.Wire_1(wireExplorer.Current());
          const faceVertices: Vertex[] = [];

          // Get all vertices from the wire
          const vertexExplorer = new oc.TopExp_Explorer_2(
            wire,
            oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
            oc.TopAbs_ShapeEnum.TopAbs_SHAPE
          );

          while (vertexExplorer.More()) {
            const vertex = oc.TopoDS.Vertex_1(vertexExplorer.Current());
            const point = oc.BRep_Tool.Pnt(vertex);

            const v = this.getOrCreateVertex(
              vertexMap,
              point.X(),
              point.Y(),
              point.Z(),
              allVertices
            );

            if (!faceVertices.includes(v)) {
              faceVertices.push(v);
            }

            vertexExplorer.Next();
          }

          // Create a face if we have enough vertices
          if (faceVertices.length >= 3) {
            faces.push(new Face(faceVertices));
          }
        }

        faceExplorer.Next();
      }

      console.log("Vertices:", allVertices);
      console.log("Edges:", allEdges);
      console.log("Faces:", faces);

      const resultBrep = new Brep(allVertices, allEdges, faces);

      // If position is specified, transform the BRep to be centered at that position
      if (position) {
        // Calculate the geometric center of the created BRep
        const bounds = this.calculateBrepBounds(resultBrep);
        const center = new THREE.Vector3(
          (bounds.minX + bounds.maxX) / 2,
          (bounds.minY + bounds.maxY) / 2,
          (bounds.minZ + bounds.maxZ) / 2
        );

        // Only transform if centers differ
        if (!center.equals(position)) {
          return transformBrepVertices(resultBrep, center, position);
        }
      }

      return resultBrep;
    } catch (error) {
      console.error("Error converting OpenCascade shape to BRep:", error);
      throw error;
    }
  }

  // Helper method to get or create a vertex
  private getOrCreateVertex(
    vertexMap: Map<string, Vertex>,
    x: number,
    y: number,
    z: number,
    allVertices: Vertex[]
  ): Vertex {
    // Increase precision to 7 decimal places for better vertex matching
    const key = `${x.toFixed(7)},${y.toFixed(7)},${z.toFixed(7)}`;
    if (vertexMap.has(key)) {
      return vertexMap.get(key)!;
    } else {
      const vertex = new Vertex(x, y, z);
      vertexMap.set(key, vertex);
      allVertices.push(vertex);
      return vertex;
    }
  }
  async booleanUnion(shape1: TopoDS_Shape, shape2: TopoDS_Shape): Promise<any> {
    const oc = await this.getOC();

    try {
      // Fix potentially problematic shapes with better precision
      const fixer1 = new oc.ShapeFix_Shape_2(shape1);
      fixer1.SetPrecision(1e-9); // Use higher precision
      const progressRange2 = new oc.Message_ProgressRange_1();
      fixer1.Perform(progressRange2);
      const fixedShape1 = fixer1.Shape();

      const fixer2 = new oc.ShapeFix_Shape_2(shape2);
      fixer2.SetPrecision(1e-9);
      fixer2.Perform(progressRange2);
      const fixedShape2 = fixer2.Shape();

      // Create boolean operation
      const booleanOperation = new oc.BRepAlgoAPI_Fuse_3(
        fixedShape1,
        fixedShape2,
        progressRange2
      );

      // Configure with optimal parameters for clean unions
      booleanOperation.SetFuzzyValue(0); // Less aggressive fuzzy tolerance
      booleanOperation.SetNonDestructive(true); // Preserve input shapes characteristics
      booleanOperation.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift); // Better handling of coincident shapes
      booleanOperation.SetCheckInverted(true); // Check for inverted solids

      // Run the operation
      await this.runOperation(booleanOperation);

      if (booleanOperation.IsDone()) {
        const resultShape = booleanOperation.Shape();

        // Apply additional healing to result shape
        const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
        finalFixer.SetPrecision(1e-9);
        finalFixer.Perform(progressRange2);

        // Orient faces correctly
        try {
          oc.BRepLib.OrientClosedSolid(resultShape);
        } catch (e) {
          console.log("Not a closed solid, orientation fix skipped");
        }

        return { shape: finalFixer.Shape() };
      } else {
        throw new Error("Boolean union operation failed");
      }
    } catch (error) {
      console.error("Error during boolean operation:", error);
      throw error;
    }
  }

  // Helper method to create a unique key for an edge
  private createEdgeKey(v1: Vertex, v2: Vertex): string {
    // Ensure consistent ordering of vertices
    if (
      v1.x < v2.x ||
      (v1.x === v2.x && v1.y < v2.y) ||
      (v1.x === v2.x && v1.y === v2.y && v1.z < v2.z)
    ) {
      return `${v1.x.toFixed(5)},${v1.y.toFixed(5)},${v1.z.toFixed(5)}-${v2.x.toFixed(5)},${v2.y.toFixed(5)},${v2.z.toFixed(5)}`;
    } else {
      return `${v2.x.toFixed(5)},${v2.y.toFixed(5)},${v2.z.toFixed(5)}-${v1.x.toFixed(5)},${v1.y.toFixed(5)},${v1.z.toFixed(5)}`;
    }
  }
}
