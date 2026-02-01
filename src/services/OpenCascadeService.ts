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

export class OpenCascadeService {
  private static instance: OpenCascadeService;
  private oc: OpenCascadeInstance | null = null;
  private initPromise: Promise<OpenCascadeInstance> | null = null;

  private constructor() {}

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
      this.initPromise = initOpenCascade();
    }

    try {
      this.oc = await this.initPromise;
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
    const bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };

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

  async brepToOCShape(
    brep: Brep,
    position?: THREE.Vector3,
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    let workingBrep = brep;

    if (position) {
      const bounds = this.calculateBrepBounds(brep);
      const actualCenter = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
      );

      if (!actualCenter.equals(position)) {
        workingBrep = transformBrepVertices(brep, actualCenter, position);
      }
    }

    try {
      const zValues = workingBrep.vertices.map((v) => v.z);
      const minZ = Math.min(...zValues);
      const maxZ = Math.max(...zValues);
      const is3D = Math.abs(maxZ - minZ) > 0.01;

      if (is3D) {
        return await this.createSolidFromBrep(oc, workingBrep);
      } else {
        return await this.createShellFromBrep(oc, workingBrep);
      }
    } catch (error) {
      console.error("Error converting BRep to OpenCascade shape:", error);
      throw error;
    }
  }

  private async createSolidFromBrep(
    oc: OpenCascadeInstance,
    brep: Brep,
  ): Promise<TopoDS_Shape> {
    const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);

    try {
      for (const face of brep.faces) {
        const vertices = face.vertices;
        if (vertices.length < 3) continue;

        const ocPoints: gp_Pnt_3[] = [];
        for (const v of vertices) {
          ocPoints.push(new oc.gp_Pnt_3(v.x, v.y, v.z));
        }

        const polygonWire = this.createPolygonWire(oc, ocPoints);
        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(
          polygonWire,
          true,
        );

        if (faceBuilder.IsDone()) {
          const ocFace = faceBuilder.Face();
          sewing.Add(ocFace);
        } else {
          console.warn("Failed to create face from wire");
        }

        ocPoints.forEach((p) => p.delete());
      }

      const progressRange = new oc.Message_ProgressRange_1();
      sewing.Perform(progressRange);
      const sewnShape = sewing.SewedShape();

      try {
        const solidMaker = new oc.BRepBuilderAPI_MakeSolid_1();
        const shellExplorer = new oc.TopExp_Explorer_2(
          sewnShape,
          oc.TopAbs_ShapeEnum.TopAbs_SHELL,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );

        if (shellExplorer.More()) {
          const shell = oc.TopoDS.Shell_1(shellExplorer.Current());
          solidMaker.Add(shell);

          const solid = solidMaker.Solid();

          try {
            oc.BRepLib.OrientClosedSolid(solid);
          } catch (e) {
            // not orientable
          }

          return solid;
        }
      } catch (solidError) {
        console.warn("Could not create solid from shell:", solidError);
      }

      return sewnShape;
    } catch (error) {
      console.error("Error in createSolidFromBrep:", error);
      throw error;
    }
  }

  private async createShellFromBrep(
    oc: OpenCascadeInstance,
    brep: Brep,
  ): Promise<TopoDS_Shape> {
    const builder = new oc.BRep_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);

    try {
      for (const face of brep.faces) {
        const vertices = face.vertices;
        if (vertices.length < 3) continue;

        const ocPoints: gp_Pnt_3[] = [];
        for (const v of vertices) {
          ocPoints.push(new oc.gp_Pnt_3(v.x, v.y, v.z));
        }

        const polygonWire = this.createPolygonWire(oc, ocPoints);

        const p1 = ocPoints[0];
        const p2 = ocPoints[1];
        const p3 = ocPoints[2];

        const v1 = new oc.gp_Vec_4(
          p2.X() - p1.X(),
          p2.Y() - p1.Y(),
          p2.Z() - p1.Z(),
        );

        const v2 = new oc.gp_Vec_4(
          p3.X() - p1.X(),
          p3.Y() - p1.Y(),
          p3.Z() - p1.Z(),
        );

        const normalVec = new oc.gp_Vec_1();
        normalVec.DotCross(v1, v2);

        let pln;
        if (normalVec.Magnitude() < 1e-7) {
          pln = new oc.gp_Pln_1();
        } else {
          const dir = new oc.gp_Dir_4(normalVec.X(), normalVec.Y(), normalVec.Z());
          pln = new oc.gp_Pln_3(p1, dir);
        }

        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(
          polygonWire,
          true,
        );

        if (faceBuilder.IsDone()) {
          const ocFace = faceBuilder.Face();
          builder.Add(compound, ocFace);
        } else {
          console.warn("Failed to create face from wire and plane");
        }

        ocPoints.forEach((p) => p.delete());
        v1.delete();
        v2.delete();
        normalVec.delete();
        pln.delete();
      }

      return compound;
    } catch (error) {
      console.error("Error in createShellFromBrep:", error);
      throw error;
    }
  }

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
        return oc.TopoDS.Wire_1(wireBuilder.Wire());
      } else {
        throw new Error("Failed to create wire");
      }
    } catch (error) {
      console.error("Error creating polygonal wire:", error);
      throw error;
    }
  }

  async runOperation(operation: any): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const oc = this.oc;
        if (!oc) throw new Error("OpenCascade not initialized");

        const progressRange = new oc.Message_ProgressRange_1();
        operation.Build(progressRange);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // converts OC shape back to brep, centers at origin
  async ocShapeToBRep(shape: TopoDS_Shape): Promise<Brep> {
    const oc = await this.getOC();

    const vertexMap = new Map<string, Vertex>();
    const edgeMap = new Map<string, Edge>();
    const faces: Face[] = [];
    const allVertices: Vertex[] = [];
    const allEdges: Edge[] = [];

    try {
      try {
        oc.BRepTools.Clean(shape, true);
      } catch (e) {
        // clean failed, continue anyway
      }

      const mesher = new oc.BRepMesh_IncrementalMesh_2(shape, 0.01, false, 0.1, true);

      const edgeExplorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      while (edgeExplorer.More()) {
        const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
        const curve = new oc.BRepAdaptor_Curve_2(edge);

        const first = curve.FirstParameter();
        const last = curve.LastParameter();

        const startPnt = curve.Value(first);
        const endPnt = curve.Value(last);

        const v1 = this.getOrCreateVertex(
          vertexMap,
          startPnt.X(),
          startPnt.Y(),
          startPnt.Z(),
          allVertices,
        );

        const v2 = this.getOrCreateVertex(
          vertexMap,
          endPnt.X(),
          endPnt.Y(),
          endPnt.Z(),
          allVertices,
        );

        const edgeKey = this.createEdgeKey(v1, v2);
        if (!edgeMap.has(edgeKey)) {
          const newEdge = new Edge(v1, v2);
          edgeMap.set(edgeKey, newEdge);
          allEdges.push(newEdge);
        }

        edgeExplorer.Next();
      }

      const faceExplorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      while (faceExplorer.More()) {
        const face = oc.TopoDS.Face_1(faceExplorer.Current());
        const location = new oc.TopLoc_Location_1();
        const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

        if (!triangulation.IsNull()) {
          const transformation = location.Transformation();
          const nbTriangles = triangulation.get().NbTriangles();
          const isReversed =
            face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

          for (let i = 1; i <= nbTriangles; i++) {
            const triangle = triangulation.get().Triangle(i);

            const n1 = triangle.Value(1);
            const n2 = triangle.Value(2);
            const n3 = triangle.Value(3);

            const node1 = triangulation.get().Node(n1);
            const node2 = triangulation.get().Node(n2);
            const node3 = triangulation.get().Node(n3);

            const p1 = node1.Transformed(transformation);
            const p2 = node2.Transformed(transformation);
            const p3 = node3.Transformed(transformation);

            const v1 = this.getOrCreateVertex(
              vertexMap,
              p1.X(),
              p1.Y(),
              p1.Z(),
              allVertices,
            );
            const v2 = this.getOrCreateVertex(
              vertexMap,
              p2.X(),
              p2.Y(),
              p2.Z(),
              allVertices,
            );
            const v3 = this.getOrCreateVertex(
              vertexMap,
              p3.X(),
              p3.Y(),
              p3.Z(),
              allVertices,
            );

            if (isReversed) {
              faces.push(new Face([v1, v3, v2]));
            } else {
              faces.push(new Face([v1, v2, v3]));
            }
          }
        }

        faceExplorer.Next();
      }

      const resultBrep = new Brep(allVertices, allEdges, faces);
      const bounds = this.calculateBrepBounds(resultBrep);
      const center = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
      );

      // recenter to origin
      const origin = new THREE.Vector3(0, 0, 0);
      const centeredBrep = transformBrepVertices(resultBrep, center, origin);

      return centeredBrep;
    } catch (error) {
      console.error("Error converting OpenCascade shape to BRep:", error);
      throw error;
    }
  }

  private getOrCreateVertex(
    vertexMap: Map<string, Vertex>,
    x: number,
    y: number,
    z: number,
    allVertices: Vertex[],
  ): Vertex {
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
      const fixer1 = new oc.ShapeFix_Shape_2(shape1);
      fixer1.SetPrecision(1e-9);
      const progressRange2 = new oc.Message_ProgressRange_1();
      fixer1.Perform(progressRange2);
      const fixedShape1 = fixer1.Shape();

      const fixer2 = new oc.ShapeFix_Shape_2(shape2);
      fixer2.SetPrecision(1e-9);
      fixer2.Perform(progressRange2);
      const fixedShape2 = fixer2.Shape();

      const booleanOperation = new oc.BRepAlgoAPI_Fuse_3(
        fixedShape1,
        fixedShape2,
        progressRange2,
      );

      booleanOperation.SetFuzzyValue(0);
      booleanOperation.SetNonDestructive(true);
      booleanOperation.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);
      booleanOperation.SetCheckInverted(true);

      await this.runOperation(booleanOperation);

      if (booleanOperation.IsDone()) {
        const resultShape = booleanOperation.Shape();

        const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
        finalFixer.SetPrecision(1e-9);
        finalFixer.Perform(progressRange2);

        try {
          oc.BRepLib.OrientClosedSolid(resultShape);
        } catch (e) {
          // not a closed solid
        }

        return { shape: finalFixer.Shape() };
      } else {
        throw new Error("Boolean union failed");
      }
    } catch (error) {
      console.error("Boolean union failed:", error);
      throw error;
    }
  }

  async shapeToThreeGeometry(
    shape: TopoDS_Shape,
    linearDeflection: number = 0.1,
    angularDeflection: number = 0.5,
  ): Promise<THREE.BufferGeometry> {
    const oc = await this.getOC();

    new oc.BRepMesh_IncrementalMesh_2(
      shape,
      linearDeflection,
      false,
      angularDeflection,
      false,
    );

    const vertices: number[] = [];
    const indices: number[] = [];
    let indexOffset = 0;

    const faceExplorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (faceExplorer.More()) {
      const face = oc.TopoDS.Face_1(faceExplorer.Current());
      const location = new oc.TopLoc_Location_1();
      const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

      if (!triangulation.IsNull()) {
        const transformation = location.Transformation();
        const nbNodes = triangulation.get().NbNodes();
        const nbTriangles = triangulation.get().NbTriangles();

        const isReversed =
          face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

        for (let i = 1; i <= nbNodes; i++) {
          const node = triangulation.get().Node(i);
          const transformedNode = node.Transformed(transformation);
          vertices.push(
            transformedNode.X(),
            transformedNode.Y(),
            transformedNode.Z(),
          );
        }

        for (let i = 1; i <= nbTriangles; i++) {
          const triangle = triangulation.get().Triangle(i);
          let n1 = triangle.Value(1) - 1 + indexOffset;
          let n2 = triangle.Value(2) - 1 + indexOffset;
          let n3 = triangle.Value(3) - 1 + indexOffset;

          if (isReversed) {
            indices.push(n1, n3, n2);
          } else {
            indices.push(n1, n2, n3);
          }
        }

        indexOffset += nbNodes;
      }

      faceExplorer.Next();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  async booleanDifference(
    baseShape: TopoDS_Shape,
    toolShape: TopoDS_Shape,
  ): Promise<{ shape: TopoDS_Shape }> {
    const oc = await this.getOC();

    try {
      const fixer1 = new oc.ShapeFix_Shape_2(baseShape);
      fixer1.SetPrecision(1e-9);
      const progressRange = new oc.Message_ProgressRange_1();
      fixer1.Perform(progressRange);
      const fixedBaseShape = fixer1.Shape();

      const fixer2 = new oc.ShapeFix_Shape_2(toolShape);
      fixer2.SetPrecision(1e-9);
      fixer2.Perform(progressRange);
      const fixedToolShape = fixer2.Shape();

      const booleanOperation = new oc.BRepAlgoAPI_Cut_3(
        fixedBaseShape,
        fixedToolShape,
        progressRange,
      );

      booleanOperation.SetFuzzyValue(1e-7);
      booleanOperation.SetNonDestructive(true);
      booleanOperation.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
      booleanOperation.SetCheckInverted(true);

      await this.runOperation(booleanOperation);

      if (booleanOperation.IsDone()) {
        const resultShape = booleanOperation.Shape();

        const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
        finalFixer.SetPrecision(1e-9);
        finalFixer.Perform(progressRange);

        try {
          oc.BRepLib.OrientClosedSolid(resultShape);
        } catch (e) {
          // not a closed solid
        }

        return { shape: finalFixer.Shape() };
      } else {
        throw new Error("Boolean difference operation failed");
      }
    } catch (error) {
      console.error("Boolean difference failed:", error);
      throw error;
    }
  }

  async booleanIntersection(
    shape1: TopoDS_Shape,
    shape2: TopoDS_Shape,
  ): Promise<{ shape: TopoDS_Shape }> {
    const oc = await this.getOC();

    try {
      const fixer1 = new oc.ShapeFix_Shape_2(shape1);
      fixer1.SetPrecision(1e-9);
      const progressRange = new oc.Message_ProgressRange_1();
      fixer1.Perform(progressRange);
      const fixedShape1 = fixer1.Shape();

      const fixer2 = new oc.ShapeFix_Shape_2(shape2);
      fixer2.SetPrecision(1e-9);
      fixer2.Perform(progressRange);
      const fixedShape2 = fixer2.Shape();

      const booleanOperation = new oc.BRepAlgoAPI_Common_3(
        fixedShape1,
        fixedShape2,
        progressRange,
      );

      booleanOperation.SetFuzzyValue(1e-7);
      booleanOperation.SetNonDestructive(true);
      booleanOperation.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
      booleanOperation.SetCheckInverted(true);

      await this.runOperation(booleanOperation);

      if (booleanOperation.IsDone()) {
        const resultShape = booleanOperation.Shape();

        const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
        finalFixer.SetPrecision(1e-9);
        finalFixer.Perform(progressRange);

        try {
          oc.BRepLib.OrientClosedSolid(resultShape);
        } catch (e) {
          // not a closed solid
        }

        return { shape: finalFixer.Shape() };
      } else {
        throw new Error("Boolean intersection operation failed");
      }
    } catch (error) {
      console.error("Boolean intersection failed:", error);
      throw error;
    }
  }

  private createEdgeKey(v1: Vertex, v2: Vertex): string {
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
