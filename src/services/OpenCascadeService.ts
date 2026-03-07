import type {
  gp_Pnt_3,
  OpenCascadeInstance,
  TopoDS_Shape,
  TopoDS_Wire,
  TopoDS_Edge,
  TopoDS_Face,
} from "opencascade.js";
import { Brep, CompoundBrep, Edge, Face, Vertex } from "../geometry";
import * as THREE from "three";
import opencascade from "opencascade.js/dist/opencascade.full.js";
import opencascadeWasm from "opencascade.js/dist/opencascade.full.wasm?url";
import { transformBrepVertices } from "../convertBRepToGeometry";
import {
  Sketch,
  SketchPrimitive,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  isSketchPoint,
  isSketchLine,
  isSketchCircle,
  isSketchArc,
} from "../types/sketch-types";

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

  resetInit(): void {
    this.oc = null;
    this.initPromise = null;
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
      const xs = workingBrep.vertices.map((v) => v.x);
      const ys = workingBrep.vertices.map((v) => v.y);
      const zs = workingBrep.vertices.map((v) => v.z);
      const rangeX = Math.max(...xs) - Math.min(...xs);
      const rangeY = Math.max(...ys) - Math.min(...ys);
      const rangeZ = Math.max(...zs) - Math.min(...zs);
      const thickAxes = (rangeX > 0.01 ? 1 : 0) + (rangeY > 0.01 ? 1 : 0) + (rangeZ > 0.01 ? 1 : 0);
      const is3D = thickAxes >= 2;

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

  /**
   * Detect if a face's vertices describe a circle (polygon approximation).
   * Returns center and radius if vertices lie on a circle, null otherwise.
   */
  private isCircularFace(vertices: Vertex[]): { center: { x: number; y: number; z: number }; radius: number; normal: { x: number; y: number; z: number } } | null {
    if (vertices.length < 8) return null;

    // Detect which plane the circle lies in by finding the flat axis
    const xs = vertices.map(v => v.x);
    const ys = vertices.map(v => v.y);
    const zs = vertices.map(v => v.z);
    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);
    const rangeZ = Math.max(...zs) - Math.min(...zs);

    let u: "x" | "y" | "z", v: "x" | "y" | "z";
    let normal: { x: number; y: number; z: number };

    if (rangeX < 0.01) {
      // YZ plane — flat along X
      u = "y"; v = "z";
      normal = { x: 1, y: 0, z: 0 };
    } else if (rangeY < 0.01) {
      // XZ plane — flat along Y
      u = "x"; v = "z";
      normal = { x: 0, y: 1, z: 0 };
    } else if (rangeZ < 0.01) {
      // XY plane — flat along Z
      u = "x"; v = "y";
      normal = { x: 0, y: 0, z: 1 };
    } else {
      return null; // Not flat, not a 2D circle
    }

    const cx = vertices.reduce((s, vert) => s + vert.x, 0) / vertices.length;
    const cy = vertices.reduce((s, vert) => s + vert.y, 0) / vertices.length;
    const cz = vertices.reduce((s, vert) => s + vert.z, 0) / vertices.length;
    const center = { x: cx, y: cy, z: cz };

    const distances = vertices.map(vert =>
      Math.sqrt((vert[u] - center[u]) ** 2 + (vert[v] - center[v]) ** 2)
    );
    const avgRadius = distances.reduce((s, d) => s + d, 0) / distances.length;
    if (avgRadius < 1e-6) return null;
    const allOnCircle = distances.every(d => Math.abs(d - avgRadius) / avgRadius < 0.01);
    if (!allOnCircle) return null;
    return { center, radius: avgRadius, normal };
  }

  private async createShellFromBrep(
    oc: OpenCascadeInstance,
    brep: Brep,
  ): Promise<TopoDS_Shape> {
    const builder = new oc.BRep_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    let faceCount = 0;
    let lastFace: TopoDS_Face | null = null;

    try {
      // Check if the entire BRep represents a single circle
      // Collect all unique vertices across all faces to detect circular shapes
      const allUniqueVerts = new Map<string, Vertex>();
      for (const face of brep.faces) {
        for (const v of face.vertices) {
          const key = `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
          allUniqueVerts.set(key, v);
        }
      }
      const circleInfo = this.isCircularFace(Array.from(allUniqueVerts.values()));

      if (circleInfo) {
        // Build an analytic circle instead of a polygon
        const centerPnt = new oc.gp_Pnt_3(circleInfo.center.x, circleInfo.center.y, circleInfo.center.z);
        const dir = new oc.gp_Dir_4(circleInfo.normal.x, circleInfo.normal.y, circleInfo.normal.z);
        const axis = new oc.gp_Ax2_3(centerPnt, dir);
        const circ = new oc.gp_Circ_2(axis, circleInfo.radius);
        const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_8(circ);
        const edge = edgeBuilder.Edge();
        const wireBuilder = new oc.BRepBuilderAPI_MakeWire_2(edge);
        const wire = wireBuilder.Wire();
        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);

        if (faceBuilder.IsDone()) {
          centerPnt.delete();
          dir.delete();
          axis.delete();
          return faceBuilder.Face();
        }

        // Cleanup on failure, fall through to polygon path
        centerPnt.delete();
        dir.delete();
        axis.delete();
      }

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
          lastFace = ocFace;
          faceCount++;
        } else {
          console.warn("Failed to create face from wire and plane");
        }

        ocPoints.forEach((p) => p.delete());
        v1.delete();
        v2.delete();
        normalVec.delete();
        pln.delete();
      }

      // Return the face directly if there's only one, avoiding unnecessary compound wrapper
      if (faceCount === 1 && lastFace) {
        return lastFace;
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

  /**
   * Convert OpenCascade shape back to Brep.
   * @param shape - The OpenCascade shape to convert
   * @param centerAtOrigin - If true, centers the result at origin (default: true for backward compatibility)
   */
  async ocShapeToBRep(shape: TopoDS_Shape, centerAtOrigin: boolean = true): Promise<Brep> {
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

      if (centerAtOrigin) {
        const bounds = this.calculateBrepBounds(resultBrep);
        const center = new THREE.Vector3(
          (bounds.minX + bounds.maxX) / 2,
          (bounds.minY + bounds.maxY) / 2,
          (bounds.minZ + bounds.maxZ) / 2,
        );

        // recenter to origin
        const origin = new THREE.Vector3(0, 0, 0);
        return transformBrepVertices(resultBrep, center, origin);
      }

      return resultBrep;
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
      const progressRange = new oc.Message_ProgressRange_1();

      const fixer1 = new oc.ShapeFix_Shape_2(shape1);
      fixer1.SetPrecision(1e-6);
      fixer1.Perform(progressRange);
      const fixedShape1 = fixer1.Shape();

      const fixer2 = new oc.ShapeFix_Shape_2(shape2);
      fixer2.SetPrecision(1e-6);
      fixer2.Perform(progressRange);
      const fixedShape2 = fixer2.Shape();

      // Use no-arg constructor so SetFuzzyValue etc. take effect before Build
      const op = new oc.BRepAlgoAPI_Fuse_1();
      op.SetFuzzyValue(1e-5);
      op.SetNonDestructive(true);
      op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
      op.SetCheckInverted(true);

      const args = new oc.TopTools_ListOfShape_1();
      args.Append_1(fixedShape1);
      op.SetArguments(args);

      const tools = new oc.TopTools_ListOfShape_1();
      tools.Append_1(fixedShape2);
      op.SetTools(tools);

      op.Build(progressRange);

      if (op.IsDone()) {
        const resultShape = op.Shape();

        const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
        finalFixer.SetPrecision(1e-6);
        finalFixer.Perform(progressRange);

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
    linearDeflection: number = 0.003,
    angularDeflection: number = 0.1,
  ): Promise<THREE.BufferGeometry> {
    const oc = await this.getOC();

    // Clean existing mesh to ensure fresh tessellation at specified parameters
    try { oc.BRepTools.Clean(shape, true); } catch { /* ignore */ }

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

  /**
   * Extract true topological edges from an OCC shape as line segments.
   * Returns a BufferGeometry suitable for THREE.LineSegments rendering.
   * Curves are sampled at the given deflection to produce smooth polylines.
   */
  async shapeToEdgeLineSegments(
    shape: TopoDS_Shape,
    linearDeflection: number = 0.003,
    allEdges: boolean = false,
  ): Promise<THREE.BufferGeometry> {
    const oc = await this.getOC();

    // Build indexed edge map and filter to sharp edges only (unless allEdges)
    const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    const count = edgeMap.Size();
    const sharpIndices = allEdges ? null : await this.getSharpEdgeIndices(shape, edgeMap, count);

    const positions: number[] = [];

    for (let i = 1; i <= count; i++) {
      if (sharpIndices && !sharpIndices.has(i)) continue;

      const edge = oc.TopoDS.Edge_1(edgeMap.FindKey(i));

      // Skip degenerate (zero-length) edges when showing all edges
      if (!sharpIndices && oc.BRep_Tool.Degenerated(edge)) continue;
      const curve = new oc.BRepAdaptor_Curve_2(edge);

      const curveType = curve.GetType();
      const first = curve.FirstParameter();
      const last = curve.LastParameter();

      // For straight lines, just emit start→end
      if (curveType === oc.GeomAbs_CurveType.GeomAbs_Line) {
        const p1 = curve.Value(first);
        const p2 = curve.Value(last);
        positions.push(p1.X(), p1.Y(), p1.Z());
        positions.push(p2.X(), p2.Y(), p2.Z());
      } else {
        // For curves (circles, arcs, splines, etc.), sample along the parameter range
        const gcpu = new oc.GCPnts_UniformDeflection_4(
          curve,
          linearDeflection,
          first,
          last,
          false,
        );

        if (gcpu.IsDone()) {
          const nbPoints = gcpu.NbPoints();
          for (let j = 1; j < nbPoints; j++) {
            const p1 = gcpu.Value(j);
            const p2 = gcpu.Value(j + 1);
            positions.push(p1.X(), p1.Y(), p1.Z());
            positions.push(p2.X(), p2.Y(), p2.Z());
          }
        } else {
          // Fallback: uniform parameter sampling
          const numSegments = 32;
          const step = (last - first) / numSegments;
          for (let j = 0; j < numSegments; j++) {
            const t1 = first + j * step;
            const t2 = first + (j + 1) * step;
            const p1 = curve.Value(t1);
            const p2 = curve.Value(t2);
            positions.push(p1.X(), p1.Y(), p1.Z());
            positions.push(p2.X(), p2.Y(), p2.Z());
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  /**
   * Extract topological vertex positions at sharp edge junctions.
   * Returns positions of vertices where 2+ distinct sharp edges meet (true corners).
   * Filters seam edges and smooth/tangent transitions, so cylinders return no vertices.
   */
  async shapeToVertexPositions(shape: TopoDS_Shape, allEdges: boolean = false): Promise<Float32Array> {
    const oc = await this.getOC();

    const { edgeMap, count } = await this.getEdgeMap(shape);
    const sharpIndices = allEdges ? null : await this.getSharpEdgeIndices(shape, edgeMap, count);

    // Track which distinct edges share each vertex position
    const vertexEdgeSet = new Map<string, { x: number; y: number; z: number; edges: Set<number> }>();
    const toKey = (x: number, y: number, z: number) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;

    // Iterate over sharp indices (filtered) or all edge indices
    const edgeIndices = sharpIndices ? sharpIndices : Array.from({ length: count }, (_, k) => k + 1);

    for (const i of edgeIndices) {
      const edgeShape = edgeMap.FindKey(i);
      const edge = oc.TopoDS.Edge_1(edgeShape);

      // Skip degenerate edges when showing all edges
      if (!sharpIndices && oc.BRep_Tool.Degenerated(edge)) continue;

      const curve = new oc.BRepAdaptor_Curve_2(edge);
      const first = curve.FirstParameter();
      const last = curve.LastParameter();

      const p1 = curve.Value(first);
      const p2 = curve.Value(last);

      const endpoints = [
        { x: p1.X(), y: p1.Y(), z: p1.Z() },
        { x: p2.X(), y: p2.Y(), z: p2.Z() },
      ];

      for (const pt of endpoints) {
        const key = toKey(pt.x, pt.y, pt.z);
        const existing = vertexEdgeSet.get(key);
        if (existing) {
          existing.edges.add(i);
        } else {
          vertexEdgeSet.set(key, { x: pt.x, y: pt.y, z: pt.z, edges: new Set([i]) });
        }
      }
    }

    // Only return vertices where 2+ distinct sharp edges meet
    const positions: number[] = [];
    for (const [, info] of vertexEdgeSet) {
      if (info.edges.size >= 2) {
        positions.push(info.x, info.y, info.z);
      }
    }

    return new Float32Array(positions);
  }

  async booleanDifference(
    baseShape: TopoDS_Shape,
    toolShape: TopoDS_Shape,
  ): Promise<{ shape: TopoDS_Shape }> {
    const oc = await this.getOC();

    try {
      const progressRange = new oc.Message_ProgressRange_1();

      const fixer1 = new oc.ShapeFix_Shape_2(baseShape);
      fixer1.SetPrecision(1e-6);
      fixer1.Perform(progressRange);
      const fixedBaseShape = fixer1.Shape();

      const fixer2 = new oc.ShapeFix_Shape_2(toolShape);
      fixer2.SetPrecision(1e-6);
      fixer2.Perform(progressRange);
      const fixedToolShape = fixer2.Shape();

      // Use no-arg constructor so SetFuzzyValue etc. take effect before Build
      const op = new oc.BRepAlgoAPI_Cut_1();
      op.SetFuzzyValue(1e-5);
      op.SetNonDestructive(true);
      op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
      op.SetCheckInverted(true);

      const args = new oc.TopTools_ListOfShape_1();
      args.Append_1(fixedBaseShape);
      op.SetArguments(args);

      const tools = new oc.TopTools_ListOfShape_1();
      tools.Append_1(fixedToolShape);
      op.SetTools(tools);

      op.Build(progressRange);

      if (op.IsDone()) {
        const resultShape = op.Shape();

        const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
        finalFixer.SetPrecision(1e-6);
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

  /**
   * Extrude a face/shell into a solid using BRepPrimAPI_MakePrism
   * @param shape - The shape to extrude (should contain at least one face)
   * @param depth - Extrusion depth (absolute value used)
   * @param direction - Extrusion direction: 1 for positive, -1 for negative (default: 1)
   * @param normalVec - Optional normal vector for extrusion direction (default: Z axis)
   * @returns The extruded solid shape (not centered - stays at extrusion position)
   */
  async extrudeShape(
    shape: TopoDS_Shape,
    depth: number,
    direction: number = 1,
    normalVec?: { x: number; y: number; z: number },
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    try {
      const progressRange = new oc.Message_ProgressRange_1();

      // Collect all faces from the shape
      const faces: any[] = [];
      const faceExplorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      while (faceExplorer.More()) {
        faces.push(oc.TopoDS.Face_1(faceExplorer.Current()));
        faceExplorer.Next();
      }
      faceExplorer.delete();

      if (faces.length === 0) {
        progressRange.delete();
        throw new Error("No face found in shape for extrusion");
      }

      console.log(`Extruding ${faces.length} faces`);

      // Create extrusion vector along the specified normal (default: Z)
      const n = normalVec || { x: 0, y: 0, z: 1 };
      const d = direction * Math.abs(depth);
      const extrusionVec = new oc.gp_Vec_4(n.x * d, n.y * d, n.z * d);

      // If there's only one face, extrude it directly
      // If there are multiple faces, we need to create a shell/compound and extrude that
      let baseShape: any;

      if (faces.length === 1) {
        baseShape = faces[0];
      } else {
        // Sew all faces together into a shell
        const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
        for (const face of faces) {
          sewing.Add(face);
        }
        sewing.Perform(progressRange);
        baseShape = sewing.SewedShape();
      }

      // Create the prism using BRepPrimAPI_MakePrism
      const prism = new oc.BRepPrimAPI_MakePrism_1(
        baseShape,
        extrusionVec,
        false, // Don't copy the base shape
        true,  // Canonize surfaces
      );

      prism.Build(progressRange);

      if (!prism.IsDone()) {
        extrusionVec.delete();
        progressRange.delete();
        throw new Error("Prism creation failed");
      }

      const result = prism.Shape();

      // Fix and orient the solid (no centering - keep at extrusion position)
      const fixer = new oc.ShapeFix_Shape_2(result);
      fixer.SetPrecision(1e-9);
      fixer.Perform(progressRange);

      try {
        oc.BRepLib.OrientClosedSolid(result);
      } catch (e) {
        // May not be orientable, continue anyway
      }

      // Clean up
      extrusionVec.delete();
      progressRange.delete();

      return fixer.Shape();
    } catch (error) {
      console.error("Failed to extrude shape:", error);
      throw error;
    }
  }

  /**
   * Build a clean planar face from a tessellated BRep's outer boundary.
   *
   * When BReps are stored, they're tessellated into triangles for rendering.
   * This method uses OpenCascade's ShapeAnalysis_FreeBounds to properly extract
   * the outer boundary and create a single clean planar face for extrusion.
   *
   * @param brep - A flat (2D) tessellated BRep
   * @returns A clean TopoDS_Face, or null if failed
   */
  async buildPlanarFaceFromBoundary(brep: Brep): Promise<TopoDS_Shape | null> {
    const oc = await this.getOC();

    try {
      // First, convert the BRep to an OC shape (shell/compound of triangles)
      const shape = await this.brepToOCShape(brep);

      if (shape.IsNull()) {
        console.warn("[OpenCascadeService] BRep conversion produced null shape");
        return null;
      }

      // If brepToOCShape already returned a single face (e.g. analytic circle),
      // it's already a clean planar face — no boundary extraction needed.
      if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_FACE) {
        console.log("[OpenCascadeService] Shape is already a single face, returning directly");
        return shape;
      }

      // Use ShapeAnalysis_FreeBounds to find the outer boundary
      // This properly identifies edges that are not shared (free bounds)
      const tolerance = 1e-5;

      // Check if ShapeAnalysis_FreeBounds is available
      if (!oc.ShapeAnalysis_FreeBounds_2) {
        console.warn("[OpenCascadeService] ShapeAnalysis_FreeBounds not available, using fallback");
        return this.buildPlanarFaceFromBoundaryFallback(brep);
      }

      const analyzer = new oc.ShapeAnalysis_FreeBounds_2(
        shape,
        tolerance,
        false, // splitclosed - don't split closed wires
        false  // splitopen - don't split open wires
      );

      const closedWires = analyzer.GetClosedWires();

      if (closedWires.IsNull()) {
        console.warn("[OpenCascadeService] No closed wires found");
        analyzer.delete();
        return null;
      }

      // Find the largest closed wire (the outer boundary)
      let outerWire: TopoDS_Wire | null = null;
      let largestArea = 0;

      const wireExplorer = new oc.TopExp_Explorer_2(
        closedWires,
        oc.TopAbs_ShapeEnum.TopAbs_WIRE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      );

      while (wireExplorer.More()) {
        const currentWire = oc.TopoDS.Wire_1(wireExplorer.Current());

        // Calculate area to find the largest (outer) wire
        try {
          const tempFaceBuilder = new oc.BRepBuilderAPI_MakeFace_15(currentWire, true);
          if (tempFaceBuilder.IsDone()) {
            const tempFace = tempFaceBuilder.Face();
            const props = new oc.GProp_GProps_1();
            oc.BRepGProp.SurfaceProperties_1(tempFace, props, 1e-7, false as any);
            const area = Math.abs(props.Mass());

            if (area > largestArea) {
              largestArea = area;
              outerWire = currentWire;
            }

            props.delete();
            tempFaceBuilder.delete();
          }
        } catch {
          // If area calculation fails, just use first closed wire
          if (!outerWire) {
            outerWire = currentWire;
          }
        }

        wireExplorer.Next();
      }

      wireExplorer.delete();
      analyzer.delete();

      if (!outerWire) {
        console.warn("[OpenCascadeService] Could not find outer boundary wire");
        return null;
      }

      console.log(`[OpenCascadeService] Found outer boundary wire with area ~${largestArea.toFixed(4)}`);

      // Create a clean planar face from the outer wire
      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);

      if (!faceBuilder.IsDone()) {
        console.warn("[OpenCascadeService] Failed to create face from boundary wire");
        return null;
      }

      console.log("[OpenCascadeService] Successfully built clean planar face from boundary");
      return faceBuilder.Face();
    } catch (error) {
      console.error("[OpenCascadeService] Failed to build planar face from boundary:", error);
      return null;
    }
  }

  /**
   * Fallback method for building planar face when ShapeAnalysis_FreeBounds is unavailable.
   * Uses manual edge counting approach.
   */
  private async buildPlanarFaceFromBoundaryFallback(brep: Brep): Promise<TopoDS_Shape | null> {
    const oc = await this.getOC();

    try {
      // Find boundary edges: edges that appear in only one face (not shared)
      const edgeCount = new Map<string, { edge: Edge; count: number }>();

      for (const face of brep.faces) {
        const verts = face.vertices;
        for (let i = 0; i < verts.length; i++) {
          const v1 = verts[i];
          const v2 = verts[(i + 1) % verts.length];

          const key = this.createEdgeKeyFromVertices(v1, v2);

          if (edgeCount.has(key)) {
            edgeCount.get(key)!.count++;
          } else {
            edgeCount.set(key, { edge: new Edge(v1, v2), count: 1 });
          }
        }
      }

      // Boundary edges appear exactly once
      const boundaryEdges: Edge[] = [];
      for (const [, data] of edgeCount) {
        if (data.count === 1) {
          boundaryEdges.push(data.edge);
        }
      }

      if (boundaryEdges.length < 3) {
        console.warn("[OpenCascadeService] Not enough boundary edges found");
        return null;
      }

      console.log(`[OpenCascadeService] (Fallback) Found ${boundaryEdges.length} boundary edges`);

      // Sort boundary edges to form a continuous chain
      const sortedVertices = this.sortBoundaryEdgesToChain(boundaryEdges);

      if (sortedVertices.length < 3) {
        console.warn("[OpenCascadeService] Could not form closed boundary chain");
        return null;
      }

      // Create OpenCascade wire from boundary vertices
      const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

      for (let i = 0; i < sortedVertices.length; i++) {
        const v1 = sortedVertices[i];
        const v2 = sortedVertices[(i + 1) % sortedVertices.length];

        const p1 = new oc.gp_Pnt_3(v1.x, v1.y, v1.z);
        const p2 = new oc.gp_Pnt_3(v2.x, v2.y, v2.z);

        const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
        if (edgeBuilder.IsDone()) {
          wireBuilder.Add_1(edgeBuilder.Edge());
        }

        p1.delete();
        p2.delete();
      }

      if (!wireBuilder.IsDone()) {
        console.warn("[OpenCascadeService] Failed to build wire from boundary");
        return null;
      }

      const wire = wireBuilder.Wire();

      if (!wire.Closed_1()) {
        console.warn("[OpenCascadeService] Boundary wire is not closed");
        return null;
      }

      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);

      if (!faceBuilder.IsDone()) {
        console.warn("[OpenCascadeService] Failed to create face from boundary wire");
        return null;
      }

      console.log("[OpenCascadeService] (Fallback) Successfully built clean planar face from boundary");
      return faceBuilder.Face();
    } catch (error) {
      console.error("[OpenCascadeService] Fallback failed:", error);
      return null;
    }
  }

  /**
   * Create a canonical edge key from two vertices (for deduplication).
   */
  private createEdgeKeyFromVertices(v1: Vertex, v2: Vertex): string {
    const precision = 1e-6;
    const x1 = Math.round(v1.x / precision) * precision;
    const y1 = Math.round(v1.y / precision) * precision;
    const z1 = Math.round(v1.z / precision) * precision;
    const x2 = Math.round(v2.x / precision) * precision;
    const y2 = Math.round(v2.y / precision) * precision;
    const z2 = Math.round(v2.z / precision) * precision;

    if (x1 < x2 || (x1 === x2 && y1 < y2) || (x1 === x2 && y1 === y2 && z1 < z2)) {
      return `${x1},${y1},${z1}-${x2},${y2},${z2}`;
    }
    return `${x2},${y2},${z2}-${x1},${y1},${z1}`;
  }

  /**
   * Sort boundary edges to form a continuous chain of vertices.
   */
  private sortBoundaryEdgesToChain(edges: Edge[]): Vertex[] {
    if (edges.length === 0) return [];

    const precision = 1e-4;
    const vertexKey = (v: Vertex) =>
      `${Math.round(v.x / precision)},${Math.round(v.y / precision)},${Math.round(v.z / precision)}`;

    const adjacency = new Map<string, Vertex[]>();

    for (const edge of edges) {
      const k1 = vertexKey(edge.start);
      const k2 = vertexKey(edge.end);

      if (!adjacency.has(k1)) adjacency.set(k1, []);
      if (!adjacency.has(k2)) adjacency.set(k2, []);

      adjacency.get(k1)!.push(edge.end);
      adjacency.get(k2)!.push(edge.start);
    }

    const result: Vertex[] = [];
    const visited = new Set<string>();

    let current = edges[0].start;
    result.push(current);
    visited.add(vertexKey(current));

    while (result.length < edges.length) {
      const key = vertexKey(current);
      const neighbors = adjacency.get(key) || [];

      let found = false;
      for (const neighbor of neighbors) {
        const nKey = vertexKey(neighbor);
        if (!visited.has(nKey)) {
          result.push(neighbor);
          visited.add(nKey);
          current = neighbor;
          found = true;
          break;
        }
      }

      if (!found) break;
    }

    return result;
  }

  async booleanIntersection(
    shape1: TopoDS_Shape,
    shape2: TopoDS_Shape,
  ): Promise<{ shape: TopoDS_Shape }> {
    const oc = await this.getOC();

    try {
      const progressRange = new oc.Message_ProgressRange_1();

      const fixer1 = new oc.ShapeFix_Shape_2(shape1);
      fixer1.SetPrecision(1e-6);
      fixer1.Perform(progressRange);
      const fixedShape1 = fixer1.Shape();

      const fixer2 = new oc.ShapeFix_Shape_2(shape2);
      fixer2.SetPrecision(1e-6);
      fixer2.Perform(progressRange);
      const fixedShape2 = fixer2.Shape();

      // Use no-arg constructor so SetFuzzyValue etc. take effect before Build
      const op = new oc.BRepAlgoAPI_Common_1();
      op.SetFuzzyValue(1e-5);
      op.SetNonDestructive(true);
      op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);
      op.SetCheckInverted(true);

      const args = new oc.TopTools_ListOfShape_1();
      args.Append_1(fixedShape1);
      op.SetArguments(args);

      const tools = new oc.TopTools_ListOfShape_1();
      tools.Append_1(fixedShape2);
      op.SetTools(tools);

      op.Build(progressRange);

      if (op.IsDone()) {
        const resultShape = op.Shape();

        const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
        finalFixer.SetPrecision(1e-6);
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

  /**
   * Convert a sketch to a BRep wire (for open profiles) or face (for closed profiles)
   */
  async sketchToBrep(sketch: Sketch): Promise<Brep> {
    const oc = await this.getOC();

    // Build a map of point IDs to their positions
    const pointMap = new Map<string, { x: number; y: number }>();
    for (const prim of sketch.primitives) {
      if (isSketchPoint(prim)) {
        pointMap.set(prim.id, { x: prim.x, y: prim.y });
      }
    }

    // Collect all edges from the sketch
    const ocEdges: TopoDS_Edge[] = [];

    for (const prim of sketch.primitives) {
      if (isSketchLine(prim)) {
        const p1 = pointMap.get(prim.p1Id);
        const p2 = pointMap.get(prim.p2Id);
        if (p1 && p2) {
          const edge = this.createLineEdge(oc, p1.x, p1.y, p2.x, p2.y);
          if (edge) ocEdges.push(edge);
        }
      } else if (isSketchCircle(prim)) {
        const center = pointMap.get(prim.centerId);
        if (center) {
          const edge = this.createCircleEdge(oc, center.x, center.y, prim.radius);
          if (edge) ocEdges.push(edge);
        }
      } else if (isSketchArc(prim)) {
        const center = pointMap.get(prim.centerId);
        const start = pointMap.get(prim.startId);
        const end = pointMap.get(prim.endId);
        if (center && start && end) {
          const edge = this.createArcEdge(
            oc,
            center.x, center.y,
            start.x, start.y,
            end.x, end.y,
            prim.radius
          );
          if (edge) ocEdges.push(edge);
        }
      }
    }

    if (ocEdges.length === 0) {
      console.warn("No edges created from sketch");
      // Return empty brep
      return new Brep([], [], []);
    }

    // Try to build a wire from the edges
    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
    for (const edge of ocEdges) {
      wireBuilder.Add_1(edge);
    }

    if (!wireBuilder.IsDone()) {
      console.warn("Could not create wire from sketch edges");
      // Return just the edges as a compound
      return this.edgesToBrep(oc, ocEdges);
    }

    const wire = wireBuilder.Wire();

    // Check if wire is closed
    const isClosed = wire.Closed_1();
    console.log("Sketch wire is closed:", isClosed);

    if (isClosed) {
      // Create a face from the closed wire
      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
      if (faceBuilder.IsDone()) {
        const face = faceBuilder.Face();
        // Convert face to Brep
        return await this.ocShapeToBRep(face);
      } else {
        console.warn("Could not create face from closed wire");
      }
    }

    // Wire is not closed or face creation failed - return wire as Brep
    return await this.ocShapeToBRep(wire);
  }

  private createLineEdge(
    oc: OpenCascadeInstance,
    x1: number, y1: number,
    x2: number, y2: number
  ): TopoDS_Edge | null {
    try {
      const p1 = new oc.gp_Pnt_3(x1, y1, 0);
      const p2 = new oc.gp_Pnt_3(x2, y2, 0);
      const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
      if (edgeBuilder.IsDone()) {
        return edgeBuilder.Edge();
      }
      p1.delete();
      p2.delete();
    } catch (e) {
      console.warn("Failed to create line edge:", e);
    }
    return null;
  }

  private createCircleEdge(
    oc: OpenCascadeInstance,
    cx: number, cy: number,
    radius: number
  ): TopoDS_Edge | null {
    try {
      const center = new oc.gp_Pnt_3(cx, cy, 0);
      const dir = new oc.gp_Dir_4(0, 0, 1); // Z-axis normal
      const axis = new oc.gp_Ax2_3(center, dir);
      const circle = new oc.gp_Circ_2(axis, radius);
      const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_8(circle);
      if (edgeBuilder.IsDone()) {
        return edgeBuilder.Edge();
      }
      center.delete();
      dir.delete();
    } catch (e) {
      console.warn("Failed to create circle edge:", e);
    }
    return null;
  }

  private createArcEdge(
    oc: OpenCascadeInstance,
    cx: number, cy: number,
    startX: number, startY: number,
    endX: number, endY: number,
    radius: number
  ): TopoDS_Edge | null {
    try {
      const center = new oc.gp_Pnt_3(cx, cy, 0);
      const dir = new oc.gp_Dir_4(0, 0, 1);
      const axis = new oc.gp_Ax2_3(center, dir);
      const circle = new oc.gp_Circ_2(axis, radius);

      // Calculate angles
      const startAngle = Math.atan2(startY - cy, startX - cx);
      const endAngle = Math.atan2(endY - cy, endX - cx);

      // Create arc using angles
      const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_9(
        circle,
        startAngle,
        endAngle
      );

      if (edgeBuilder.IsDone()) {
        return edgeBuilder.Edge();
      }

      center.delete();
      dir.delete();
    } catch (e) {
      console.warn("Failed to create arc edge:", e);
    }
    return null;
  }

  private edgesToBrep(oc: OpenCascadeInstance, edges: TopoDS_Edge[]): Brep {
    // Simple conversion: just extract vertices from edges
    const vertices: Vertex[] = [];
    const brepEdges: Edge[] = [];

    for (const edge of edges) {
      try {
        const curve = new oc.BRepAdaptor_Curve_2(edge);
        const first = curve.FirstParameter();
        const last = curve.LastParameter();

        const startPnt = curve.Value(first);
        const endPnt = curve.Value(last);

        const v1 = new Vertex(startPnt.X(), startPnt.Y(), startPnt.Z());
        const v2 = new Vertex(endPnt.X(), endPnt.Y(), endPnt.Z());

        vertices.push(v1, v2);
        brepEdges.push(new Edge(v1, v2));
      } catch (e) {
        console.warn("Failed to extract edge points:", e);
      }
    }

    return new Brep(vertices, brepEdges, []);
  }

  /**
   * Detect all closed planar regions from a set of edges using BOPAlgo_Tools.
   * This is the correct OpenCascade workflow for profile detection:
   * 1. EdgesToWires - automatically computes intersections and splits edges
   * 2. WiresToFaces - finds all closed planar regions from the wires
   *
   * For example, a rectangle + overlapping circle returns 3 faces:
   * - The crescent (outer part of circle outside rectangle)
   * - The lens shape (inner part of circle inside rectangle)
   * - The rectangle with the "bite" taken out
   *
   * @param edges - Array of edges (may intersect/overlap)
   * @returns Array of faces representing all closed regions
   */
  async detectProfileRegions(edges: TopoDS_Edge[]): Promise<TopoDS_Face[]> {
    const oc = await this.getOC();

    if (edges.length < 1) {
      console.warn("[OpenCascadeService] Need at least 1 edge to detect profiles");
      return [];
    }

    try {
      // Build compound of all edges
      const builder = new oc.BRep_Builder();
      const edgeCompound = new oc.TopoDS_Compound();
      builder.MakeCompound(edgeCompound);

      for (const edge of edges) {
        builder.Add(edgeCompound, edge);
      }

      // Step 1: Convert edges to wires (automatically splits at intersections)
      // Create output compound for wires
      const wireCompound = new oc.TopoDS_Compound();
      builder.MakeCompound(wireCompound);

      const theShared = false;  // edges are NOT pre-shared, need intersection detection
      const angularTolerance = 1e-8;

      console.log(`[OpenCascadeService] Running EdgesToWires with ${edges.length} edges...`);

      const wireResult = oc.BOPAlgo_Tools.EdgesToWires(
        edgeCompound,
        wireCompound,
        theShared,
        angularTolerance
      );

      if (wireResult !== 0) {
        console.warn(`[OpenCascadeService] EdgesToWires failed with code ${wireResult}`);
        return [];
      }

      // Count wires created
      let wireCount = 0;
      const wireExplorer = new oc.TopExp_Explorer_2(
        wireCompound,
        oc.TopAbs_ShapeEnum.TopAbs_WIRE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      );
      while (wireExplorer.More()) {
        wireCount++;
        wireExplorer.Next();
      }
      wireExplorer.delete();

      console.log(`[OpenCascadeService] EdgesToWires created ${wireCount} wires`);

      // Step 2: Convert wires to faces (finds all closed regions)
      const faceCompound = new oc.TopoDS_Compound();
      builder.MakeCompound(faceCompound);

      const success = oc.BOPAlgo_Tools.WiresToFaces(
        wireCompound,
        faceCompound,
        angularTolerance
      );

      if (!success) {
        console.warn("[OpenCascadeService] WiresToFaces returned false");
        return [];
      }

      // Extract faces from result compound
      const faces: TopoDS_Face[] = [];
      const faceExplorer = new oc.TopExp_Explorer_2(
        faceCompound,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      );

      while (faceExplorer.More()) {
        faces.push(oc.TopoDS.Face_1(faceExplorer.Current()));
        faceExplorer.Next();
      }

      faceExplorer.delete();
      console.log(`[OpenCascadeService] WiresToFaces found ${faces.length} regions`);

      return faces;
    } catch (error) {
      console.error("[OpenCascadeService] Profile region detection failed:", error);
      return [];
    }
  }

  /**
   * @deprecated Use detectProfileRegions instead
   */
  async splitEdgesAtIntersections(edges: TopoDS_Edge[]): Promise<TopoDS_Edge[]> {
    console.warn("[OpenCascadeService] splitEdgesAtIntersections is deprecated, use detectProfileRegions");
    return edges;
  }

  /**
   * @deprecated Use detectProfileRegions instead
   */
  async buildFacesFromEdges(edges: TopoDS_Edge[], plane?: TopoDS_Face): Promise<TopoDS_Face[]> {
    console.warn("[OpenCascadeService] buildFacesFromEdges is deprecated, use detectProfileRegions");
    return this.detectProfileRegions(edges);
  }

  /**
   * Convert a TopoDS_Face to a Brep, with optional centering.
   * Does NOT recenter by default (keeps absolute coordinates).
   */
  async faceToBrep(face: TopoDS_Face, center: boolean = false): Promise<Brep> {
    const oc = await this.getOC();

    const vertexMap = new Map<string, Vertex>();
    const edgeMap = new Map<string, Edge>();
    const faces: Face[] = [];
    const allVertices: Vertex[] = [];
    const allEdges: Edge[] = [];

    try {
      // Mesh the face
      new oc.BRepMesh_IncrementalMesh_2(face, 0.01, false, 0.1, true);

      // Get triangulation
      const location = new oc.TopLoc_Location_1();
      const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

      if (triangulation.IsNull()) {
        console.warn("[OpenCascadeService] No triangulation for face");
        return new Brep([], [], []);
      }

      const transformation = location.Transformation();
      const nbTriangles = triangulation.get().NbTriangles();
      const isReversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

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

        const v1 = this.getOrCreateVertex(vertexMap, p1.X(), p1.Y(), p1.Z(), allVertices);
        const v2 = this.getOrCreateVertex(vertexMap, p2.X(), p2.Y(), p2.Z(), allVertices);
        const v3 = this.getOrCreateVertex(vertexMap, p3.X(), p3.Y(), p3.Z(), allVertices);

        if (isReversed) {
          faces.push(new Face([v1, v3, v2]));
        } else {
          faces.push(new Face([v1, v2, v3]));
        }
      }

      const resultBrep = new Brep(allVertices, allEdges, faces);

      if (center) {
        const bounds = this.calculateBrepBounds(resultBrep);
        const centerPos = new THREE.Vector3(
          (bounds.minX + bounds.maxX) / 2,
          (bounds.minY + bounds.maxY) / 2,
          (bounds.minZ + bounds.maxZ) / 2
        );
        const origin = new THREE.Vector3(0, 0, 0);
        return transformBrepVertices(resultBrep, centerPos, origin);
      }

      return resultBrep;
    } catch (error) {
      console.error("[OpenCascadeService] Face to BRep conversion failed:", error);
      return new Brep([], [], []);
    }
  }

  /**
   * Convert a TopoDS_Face to a centered Brep AND return its center offset.
   * Single tessellation pass — avoids redundant dual calls to faceToBrep().
   */
  async faceToBrepWithCenter(face: TopoDS_Face): Promise<{ brep: Brep; center: { x: number; y: number; z: number } }> {
    const absoluteBrep = await this.faceToBrep(face, false);

    if (absoluteBrep.vertices.length === 0) {
      return { brep: absoluteBrep, center: { x: 0, y: 0, z: 0 } };
    }

    const bounds = this.calculateBrepBounds(absoluteBrep);
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2
    };

    const centerPos = new THREE.Vector3(center.x, center.y, center.z);
    const origin = new THREE.Vector3(0, 0, 0);
    const brep = transformBrepVertices(absoluteBrep, centerPos, origin);

    return { brep, center };
  }

  /**
   * Build an indexed map of unique edges from a shape.
   * Returns 1-based indexed edge map (stable indices for fillet/chamfer operations).
   */
  async getEdgeMap(shape: TopoDS_Shape): Promise<{ edgeMap: any; count: number }> {
    const oc = await this.getOC();
    const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    return { edgeMap, count: edgeMap.Size() };
  }

  /**
   * Filter edge indices to only sharp edges (skip degenerate, seam, smooth/tangent).
   * Uses edge→face adjacency + BRep_Tool.Continuity to detect fillet blend edges.
   * Returns a Set of 1-based edge indices that are sharp.
   */
  private async getSharpEdgeIndices(
    shape: TopoDS_Shape,
    edgeMap: any,
    count: number,
  ): Promise<Set<number>> {
    const oc = await this.getOC();
    const sharpIndices = new Set<number>();

    // Build edge → face adjacency map
    const edgeFaceMap = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
    oc.TopExp.MapShapesAndAncestors(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      edgeFaceMap,
    );

    for (let i = 1; i <= count; i++) {
      try {
        const edgeShape = edgeMap.FindKey(i);
        const edge = oc.TopoDS.Edge_1(edgeShape);

        // Skip degenerate edges (zero-length point edges)
        if (oc.BRep_Tool.Degenerated(edge)) continue;

        // Find this edge in the adjacency map
        const adjIdx = edgeFaceMap.FindIndex(edgeShape);
        if (adjIdx === 0) continue;

        const faceList = edgeFaceMap.FindFromIndex(adjIdx);

        // Skip seam/boundary edges (need exactly 2 adjacent faces)
        if (faceList.Size() !== 2) continue;

        // Get the two adjacent faces
        const face1 = oc.TopoDS.Face_1(faceList.First_1());

        // Skip seam edges (edge with two pcurves on same face, e.g. cylinder/cone seams)
        if (oc.BRep_Tool.IsClosed_2(edge, face1)) continue;

        const face2 = oc.TopoDS.Face_1(faceList.Last_1());

        // Check continuity — smooth edges (G1/C1+) are fillet transitions
        const continuity = oc.BRep_Tool.Continuity_1(edge, face1, face2);
        if (continuity !== oc.GeomAbs_Shape.GeomAbs_C0) continue;

        sharpIndices.add(i);
      } catch {
        // Skip edges that fail continuity/closure checks (e.g. pipe shell edges)
        continue;
      }
    }

    edgeFaceMap.delete();
    return sharpIndices;
  }

  /**
   * Get per-edge tessellated line segments from a shape.
   * Each edge is tessellated individually, enabling mapping raycast hits to edge indices.
   * Returns array of { edgeIndex, segments (Float32Array), midpoint }.
   */
  async getEdgeLineSegmentsPerEdge(
    shape: TopoDS_Shape,
    linearDeflection: number = 0.003,
    skipFix: boolean = false,
    allEdges: boolean = false,
  ): Promise<Array<{ edgeIndex: number; segments: Float32Array; midpoint: { x: number; y: number; z: number } }>> {
    const oc = await this.getOC();

    // Fix input shape to match what filletEdges/chamferEdges will use
    // Skip if shape was already fixed (e.g. deserialized from occBrep)
    let fixedShape: TopoDS_Shape;
    if (skipFix) {
      fixedShape = shape;
    } else {
      const progressRange = new oc.Message_ProgressRange_1();
      const fixer = new oc.ShapeFix_Shape_2(shape);
      fixer.SetPrecision(1e-6);
      fixer.Perform(progressRange);
      fixedShape = fixer.Shape();
    }

    const { edgeMap, count } = await this.getEdgeMap(fixedShape);
    // When allEdges is true, skip sharp-edge filter (e.g. for revolve axis selection on flat profiles)
    const sharpIndices = allEdges ? null : await this.getSharpEdgeIndices(fixedShape, edgeMap, count);
    const result: Array<{ edgeIndex: number; segments: Float32Array; midpoint: { x: number; y: number; z: number } }> = [];

    for (let i = 1; i <= count; i++) {
      if (sharpIndices && !sharpIndices.has(i)) continue;
      const edgeShape = edgeMap.FindKey(i);
      const edge = oc.TopoDS.Edge_1(edgeShape);
      // Skip degenerate edges (zero-length point edges)
      if (oc.BRep_Tool.Degenerated(edge)) continue;
      const curve = new oc.BRepAdaptor_Curve_2(edge);

      const curveType = curve.GetType();
      const first = curve.FirstParameter();
      const last = curve.LastParameter();

      const positions: number[] = [];

      if (curveType === oc.GeomAbs_CurveType.GeomAbs_Line) {
        const p1 = curve.Value(first);
        const p2 = curve.Value(last);
        positions.push(p1.X(), p1.Y(), p1.Z());
        positions.push(p2.X(), p2.Y(), p2.Z());
      } else {
        const gcpu = new oc.GCPnts_UniformDeflection_4(
          curve, linearDeflection, first, last, false,
        );

        if (gcpu.IsDone()) {
          const nbPoints = gcpu.NbPoints();
          for (let j = 1; j < nbPoints; j++) {
            const p1 = gcpu.Value(j);
            const p2 = gcpu.Value(j + 1);
            positions.push(p1.X(), p1.Y(), p1.Z());
            positions.push(p2.X(), p2.Y(), p2.Z());
          }
        } else {
          const numSegments = 32;
          const step = (last - first) / numSegments;
          for (let j = 0; j < numSegments; j++) {
            const t1 = first + j * step;
            const t2 = first + (j + 1) * step;
            const p1 = curve.Value(t1);
            const p2 = curve.Value(t2);
            positions.push(p1.X(), p1.Y(), p1.Z());
            positions.push(p2.X(), p2.Y(), p2.Z());
          }
        }
      }

      // Calculate midpoint from edge's midpoint parameter
      const midParam = (first + last) / 2;
      const midPt = curve.Value(midParam);
      const midpoint = { x: midPt.X(), y: midPt.Y(), z: midPt.Z() };

      result.push({
        edgeIndex: i,
        segments: new Float32Array(positions),
        midpoint,
      });
    }

    return result;
  }

  /**
   * Apply fillet (rounding) to specified edges of a shape.
   * Uses BRepFilletAPI_MakeFillet with constant radius.
   */
  async filletEdges(
    shape: TopoDS_Shape,
    edgeIndices: number[],
    radius: number,
    skipFix: boolean = false,
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    try {
      const progressRange = new oc.Message_ProgressRange_1();

      // Fix input shape — skip if already fixed (e.g. deserialized from occBrep)
      let fixedShape: TopoDS_Shape;
      if (skipFix) {
        fixedShape = shape;
      } else {
        const fixer = new oc.ShapeFix_Shape_2(shape);
        fixer.SetPrecision(1e-6);
        fixer.Perform(progressRange);
        fixedShape = fixer.Shape();
      }

      // Build edge map
      const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
      oc.TopExp.MapShapes_1(fixedShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);

      // Create fillet operation
      const fillet = new oc.BRepFilletAPI_MakeFillet(fixedShape, oc.ChFi3d_FilletShape.ChFi3d_Rational as any);

      for (const idx of edgeIndices) {
        if (idx >= 1 && idx <= edgeMap.Size()) {
          const edgeShape = edgeMap.FindKey(idx);
          const edge = oc.TopoDS.Edge_1(edgeShape);
          fillet.Add_2(radius, edge);
        }
      }

      fillet.Build(progressRange);

      if (!fillet.IsDone()) {
        throw new Error("Fillet operation failed — radius may be too large for the geometry");
      }

      const resultShape = fillet.Shape();

      // Fix result
      const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
      finalFixer.SetPrecision(1e-6);
      finalFixer.Perform(progressRange);

      try {
        oc.BRepLib.OrientClosedSolid(resultShape);
      } catch (e) {
        // not a closed solid
      }

      return finalFixer.Shape();
    } catch (error) {
      console.error("Fillet operation failed:", error);
      throw error;
    }
  }

  /**
   * Apply chamfer (beveling) to specified edges of a shape.
   * Uses BRepFilletAPI_MakeChamfer with symmetric distance.
   */
  async chamferEdges(
    shape: TopoDS_Shape,
    edgeIndices: number[],
    distance: number,
    skipFix: boolean = false,
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    try {
      const progressRange = new oc.Message_ProgressRange_1();

      // Fix input shape — skip if already fixed (e.g. deserialized from occBrep)
      let fixedShape: TopoDS_Shape;
      if (skipFix) {
        fixedShape = shape;
      } else {
        const fixer = new oc.ShapeFix_Shape_2(shape);
        fixer.SetPrecision(1e-6);
        fixer.Perform(progressRange);
        fixedShape = fixer.Shape();
      }

      // Build edge map
      const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
      oc.TopExp.MapShapes_1(fixedShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);

      // Create chamfer operation
      const chamfer = new oc.BRepFilletAPI_MakeChamfer(fixedShape);

      for (const idx of edgeIndices) {
        if (idx >= 1 && idx <= edgeMap.Size()) {
          const edgeShape = edgeMap.FindKey(idx);
          const edge = oc.TopoDS.Edge_1(edgeShape);
          chamfer.Add_2(distance, edge);
        }
      }

      chamfer.Build(progressRange);

      if (!chamfer.IsDone()) {
        throw new Error("Chamfer operation failed — distance may be too large for the geometry");
      }

      const resultShape = chamfer.Shape();

      // Fix result
      const finalFixer = new oc.ShapeFix_Shape_2(resultShape);
      finalFixer.SetPrecision(1e-6);
      finalFixer.Perform(progressRange);

      try {
        oc.BRepLib.OrientClosedSolid(resultShape);
      } catch (e) {
        // not a closed solid
      }

      return finalFixer.Shape();
    } catch (error) {
      console.error("Chamfer operation failed:", error);
      throw error;
    }
  }

  /**
   * Calculate the signed area of a face.
   * Positive area = counterclockwise orientation (interior face).
   */
  async calculateFaceArea(face: TopoDS_Face): Promise<number> {
    const oc = await this.getOC();

    try {
      const props = new oc.GProp_GProps_1();
      // Type assertion needed - OC type system expects boolean but uses number
      oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false as any);
      return props.Mass();
    } catch (error) {
      console.error("[OpenCascadeService] Area calculation failed:", error);
      return 0;
    }
  }

  /**
   * Build a wire from an ordered list of 3D points.
   * Creates straight edges between consecutive points and joins them into a wire.
   */
  async buildWireFromPoints(
    points: { x: number; y: number; z: number }[]
  ): Promise<TopoDS_Wire | null> {
    if (points.length < 2) return null;

    const oc = await this.getOC();
    let wireBuilder: ReturnType<typeof oc.BRepBuilderAPI_MakeWire_1> | null = null;

    try {
      wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = new oc.gp_Pnt_3(points[i].x, points[i].y, points[i].z);
        const p2 = new oc.gp_Pnt_3(points[i + 1].x, points[i + 1].y, points[i + 1].z);
        let edgeBuilder: ReturnType<typeof oc.BRepBuilderAPI_MakeEdge_3> | null = null;

        try {
          edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
          if (edgeBuilder.IsDone()) {
            wireBuilder.Add_1(edgeBuilder.Edge());
          }
        } finally {
          p1.delete();
          p2.delete();
          edgeBuilder?.delete();
        }
      }

      if (!wireBuilder.IsDone()) {
        console.warn("[OpenCascadeService] buildWireFromPoints: wire builder failed");
        return null;
      }

      return wireBuilder.Wire();
    } catch (error) {
      console.error("[OpenCascadeService] buildWireFromPoints failed:", error);
      return null;
    } finally {
      wireBuilder?.delete();
    }
  }

  /**
   * Sweep a profile face along a path wire using BRepOffsetAPI_MakePipe.
   */
  async sweepShape(
    profileFace: TopoDS_Shape,
    pathWire: TopoDS_Wire
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    let pipe: any = null;
    let fixer: any = null;

    try {
      pipe = new oc.BRepOffsetAPI_MakePipe_1(pathWire, profileFace);
      pipe.Build(new oc.Message_ProgressRange_1());

      if (!pipe.IsDone()) {
        throw new Error("BRepOffsetAPI_MakePipe failed");
      }

      let result = pipe.Shape();

      // Fix shape
      fixer = new oc.ShapeFix_Shape_2(result);
      fixer.Perform(new oc.Message_ProgressRange_1());
      result = fixer.Shape();

      // Orient as solid
      try {
        oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result));
      } catch {
        // Not a solid — fine for open sweeps
      }

      return result;
    } catch (error) {
      console.error("[OpenCascadeService] sweepShape failed:", error);
      throw error;
    } finally {
      pipe?.delete();
      fixer?.delete();
    }
  }

  /**
   * Sweep a profile face along a path wire using BRepOffsetAPI_MakePipeShell.
   * Supports orientation control and corner treatment modes.
   * Falls back to sweepShape() (MakePipe) on failure.
   */
  async sweepShapeAdvanced(
    profileFace: TopoDS_Shape,
    pathWire: TopoDS_Wire,
    options: {
      orientation: "perpendicular" | "parallel";
      cornerMode: "right" | "round";
    }
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    let pipeShell: any = null;
    let fixer: any = null;
    let profileWire: any = null;
    let ax2: any = null;
    let axOrigin: any = null;
    let axDir: any = null;
    let axXDir: any = null;

    try {
      // Extract outer wire from face (MakePipeShell takes a wire, not a face)
      const face = oc.TopoDS.Face_1(profileFace);
      profileWire = oc.BRepTools.OuterWire(face);

      // Create pipe shell builder
      pipeShell = new oc.BRepOffsetAPI_MakePipeShell(pathWire);

      // Set orientation mode
      if (options.orientation === "perpendicular") {
        pipeShell.SetDiscreteMode();
      } else {
        // "parallel" — fixed frame using profile's original plane orientation
        // Use the XY plane as the reference frame (profile is built at origin on XY plane)
        axOrigin = new oc.gp_Pnt_3(0, 0, 0);
        axDir = new oc.gp_Dir_4(0, 0, 1);
        axXDir = new oc.gp_Dir_4(1, 0, 0);
        ax2 = new oc.gp_Ax2_3(axOrigin, axDir, axXDir);
        pipeShell.SetMode_2(ax2);
      }

      // Set corner transition mode
      if (options.cornerMode === "right") {
        pipeShell.SetTransitionMode(
          oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner as any
        );
      } else {
        pipeShell.SetTransitionMode(
          oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RoundCorner as any
        );
      }

      // Add profile wire with WithCorrection=true for strict orthogonality
      pipeShell.Add_1(profileWire, false, true);

      // Build the pipe shell
      pipeShell.Build(new oc.Message_ProgressRange_1());

      if (!pipeShell.IsDone()) {
        console.warn("[OpenCascadeService] MakePipeShell failed, falling back to MakePipe");
        return this.sweepShape(profileFace, pathWire);
      }

      // Make solid (close end caps)
      pipeShell.MakeSolid();

      let result = pipeShell.Shape();

      // Fix shape
      fixer = new oc.ShapeFix_Shape_2(result);
      fixer.Perform(new oc.Message_ProgressRange_1());
      result = fixer.Shape();

      // Orient as solid
      try {
        oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result));
      } catch {
        // Not a solid — fine for open sweeps
      }

      return result;
    } catch (error) {
      console.warn("[OpenCascadeService] sweepShapeAdvanced failed, falling back to MakePipe:", error);
      return this.sweepShape(profileFace, pathWire);
    } finally {
      pipeShell?.delete();
      fixer?.delete();
      ax2?.delete();
      axOrigin?.delete();
      axDir?.delete();
      axXDir?.delete();
    }
  }

  /**
   * Revolve a shape around an axis to create a solid of revolution.
   * @param face Shape to revolve (face)
   * @param axisOrigin Point on the revolution axis
   * @param axisDir Direction of the revolution axis
   * @param angleRadians Angle in radians (omit or pass 2*PI for full revolution)
   */
  async revolveShape(
    face: TopoDS_Shape,
    axisOrigin: { x: number; y: number; z: number },
    axisDir: { x: number; y: number; z: number },
    angleRadians?: number
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    let origin: any = null;
    let direction: any = null;
    let axis: any = null;
    let revolBuilder: any = null;
    let fixer: any = null;

    try {
      origin = new oc.gp_Pnt_3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
      direction = new oc.gp_Dir_4(axisDir.x, axisDir.y, axisDir.z);
      axis = new oc.gp_Ax1_2(origin, direction);

      const isFullRevolution = angleRadians === undefined ||
        Math.abs(angleRadians - 2 * Math.PI) < 1e-6;

      console.log("[revolveShape] Input shape type:", face.ShapeType());

      if (isFullRevolution) {
        revolBuilder = new oc.BRepPrimAPI_MakeRevol_2(face, axis, true);
      } else {
        revolBuilder = new oc.BRepPrimAPI_MakeRevol_1(face, axis, angleRadians!, true);
      }

      try {
        revolBuilder.Build(new oc.Message_ProgressRange_1());
      } catch (buildError) {
        const buildMsg = buildError instanceof Error ? buildError.message : String(buildError);
        throw new Error(`BRepPrimAPI_MakeRevol.Build() threw: ${buildMsg}`);
      }

      if (!revolBuilder.IsDone()) {
        // Best-effort diagnostics
        try {
          const analyzer = new oc.BRepCheck_Analyzer(face, true, false);
          const isValid = analyzer.IsValid_2();
          console.error("[revolveShape] Input face valid:", isValid);
          analyzer.delete();
        } catch { /* best effort */ }

        try {
          revolBuilder.Check();
        } catch (checkError) {
          const checkMsg = checkError instanceof Error ? checkError.message : String(checkError);
          console.error("[revolveShape] Check() exception:", checkMsg);
        }

        throw new Error("BRepPrimAPI_MakeRevol: IsDone() returned false");
      }

      let result = revolBuilder.Shape();

      // Fix shape
      fixer = new oc.ShapeFix_Shape_2(result);
      fixer.Perform(new oc.Message_ProgressRange_1());
      result = fixer.Shape();

      // Orient as solid
      try {
        oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result));
      } catch {
        // Not a closed solid — fine for partial revolutions
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[OpenCascadeService] revolveShape failed:", msg);
      throw new Error(`Revolve failed: ${msg}`);
    } finally {
      origin?.delete();
      direction?.delete();
      axis?.delete();
      revolBuilder?.delete();
      fixer?.delete();
    }
  }

  /**
   * Loft through multiple profile wires using BRepOffsetAPI_ThruSections.
   * @param profileFaces Array of profile faces (in order)
   * @param isSolid Whether to create a solid (true) or shell (false)
   * @param isRuled Whether to use ruled surfaces (true) or smooth (false)
   */
  async loftShapes(
    profileFaces: TopoDS_Shape[],
    isSolid: boolean = true,
    isRuled: boolean = false
  ): Promise<TopoDS_Shape> {
    const oc = await this.getOC();

    let thruSections: any = null;
    let fixer: any = null;

    try {
      thruSections = new oc.BRepOffsetAPI_ThruSections(isSolid, isRuled, 1e-6);

      // Extract outer wire from each face and add to loft
      for (let i = 0; i < profileFaces.length; i++) {
        const face = profileFaces[i];
        const explorer = new oc.TopExp_Explorer_2(
          face,
          oc.TopAbs_ShapeEnum.TopAbs_WIRE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        );

        if (explorer.More()) {
          const wire = oc.TopoDS.Wire_1(explorer.Current());
          thruSections.AddWire(wire);
        } else {
          console.warn(`[OpenCascadeService] loftShapes: face ${i} has no wire`);
        }
        explorer.delete();
      }

      thruSections.Build(new oc.Message_ProgressRange_1());

      if (!thruSections.IsDone()) {
        throw new Error("BRepOffsetAPI_ThruSections failed");
      }

      let result = thruSections.Shape();

      // Fix shape
      fixer = new oc.ShapeFix_Shape_2(result);
      fixer.Perform(new oc.Message_ProgressRange_1());
      result = fixer.Shape();

      // Orient as solid
      try {
        oc.BRepLib.OrientClosedSolid(oc.TopoDS.Solid_1(result));
      } catch {
        // Not a solid — fine for shell results
      }

      return result;
    } catch (error) {
      console.error("[OpenCascadeService] loftShapes failed:", error);
      throw error;
    } finally {
      thruSections?.delete();
      fixer?.delete();
    }
  }

  /**
   * Serialize an OCC TopoDS_Shape to BRep text format.
   * Preserves analytic geometry (curves, surfaces, continuity) losslessly.
   */
  async serializeShape(shape: TopoDS_Shape): Promise<string> {
    const oc = await this.getOC();
    const filePath = "/tmp/occ_brep_out.brep";
    const progress = new oc.Message_ProgressRange_1();

    try {
      const success = oc.BRepTools.Write_3(shape, filePath, progress);
      if (!success) {
        throw new Error("BRepTools.Write_3 failed");
      }

      const brepString = oc.FS.readFile(filePath, { encoding: "utf8" }) as string;
      return brepString;
    } finally {
      try { oc.FS.unlink(filePath); } catch { /* ignore */ }
      progress.delete();
    }
  }

  /**
   * Deserialize a BRep text string back to a TopoDS_Shape.
   */
  async deserializeShape(brepString: string): Promise<TopoDS_Shape> {
    const oc = await this.getOC();
    const filePath = "/tmp/occ_brep_in.brep";
    const progress = new oc.Message_ProgressRange_1();

    try {
      oc.FS.writeFile(filePath, brepString);

      const builder = new oc.BRep_Builder();
      const shape = new oc.TopoDS_Shape();
      const success = oc.BRepTools.Read_2(shape, filePath, builder, progress);

      if (!success) {
        shape.delete();
        throw new Error("BRepTools.Read_2 failed");
      }

      return shape;
    } finally {
      try { oc.FS.unlink(filePath); } catch { /* ignore */ }
      progress.delete();
    }
  }

  /**
   * Deserialize an occBrep string and optionally translate to world position.
   * Replaces the lossy brepToOCShape(brep, position) path when occBrep is available.
   */
  async occBrepToOCShape(occBrep: string, position?: THREE.Vector3): Promise<TopoDS_Shape> {
    const oc = await this.getOC();
    let shape = await this.deserializeShape(occBrep);

    if (position && (position.x !== 0 || position.y !== 0 || position.z !== 0)) {
      const trsf = new oc.gp_Trsf_1();
      const vec = new oc.gp_Vec_4(position.x, position.y, position.z);
      trsf.SetTranslation_1(vec);
      vec.delete();

      const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
      trsf.delete();
      shape = transformer.Shape();
      transformer.delete();
    }

    return shape;
  }

  // ─── Measurement Methods ─────────────────────────────────────────────

  /**
   * Get the precise length of an edge (including curved edges like arcs).
   * Uses GProp_GProps + BRepGProp.LinearProperties for accurate measurement.
   */
  async getEdgeLength(
    shape: TopoDS_Shape,
    edgeIndex: number,
    skipFix: boolean = false,
  ): Promise<number> {
    const oc = await this.getOC();

    let fixedShape: TopoDS_Shape;
    if (skipFix) {
      fixedShape = shape;
    } else {
      const progressRange = new oc.Message_ProgressRange_1();
      const fixer = new oc.ShapeFix_Shape_2(shape);
      fixer.SetPrecision(1e-6);
      fixer.Perform(progressRange);
      fixedShape = fixer.Shape();
    }

    const { edgeMap, count } = await this.getEdgeMap(fixedShape);

    if (edgeIndex < 1 || edgeIndex > count) {
      edgeMap.delete();
      throw new Error(`[OpenCascadeService] getEdgeLength: edgeIndex ${edgeIndex} out of range [1, ${count}]`);
    }

    const edgeShape = edgeMap.FindKey(edgeIndex);
    const edge = oc.TopoDS.Edge_1(edgeShape);

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.LinearProperties(edge, props, false, false);
    const length = props.Mass();

    props.delete();
    edgeMap.delete();

    return length;
  }

  /**
   * Get the tangent direction vector at the midpoint of an edge.
   * Returns a normalized direction.
   */
  async getEdgeDirectionAtMidpoint(
    shape: TopoDS_Shape,
    edgeIndex: number,
    skipFix: boolean = false,
  ): Promise<{ x: number; y: number; z: number }> {
    const oc = await this.getOC();

    let fixedShape: TopoDS_Shape;
    if (skipFix) {
      fixedShape = shape;
    } else {
      const progressRange = new oc.Message_ProgressRange_1();
      const fixer = new oc.ShapeFix_Shape_2(shape);
      fixer.SetPrecision(1e-6);
      fixer.Perform(progressRange);
      fixedShape = fixer.Shape();
    }

    const { edgeMap, count } = await this.getEdgeMap(fixedShape);

    if (edgeIndex < 1 || edgeIndex > count) {
      edgeMap.delete();
      throw new Error(`[OpenCascadeService] getEdgeDirectionAtMidpoint: edgeIndex ${edgeIndex} out of range [1, ${count}]`);
    }

    const edgeShape = edgeMap.FindKey(edgeIndex);
    const edge = oc.TopoDS.Edge_1(edgeShape);
    const curve = new oc.BRepAdaptor_Curve_2(edge);

    const first = curve.FirstParameter();
    const last = curve.LastParameter();
    const midParam = (first + last) / 2;

    const tangent = curve.DN(midParam, 1);
    const mag = tangent.Magnitude();

    let result: { x: number; y: number; z: number };
    if (mag < 1e-12) {
      const p1 = curve.Value(first);
      const p2 = curve.Value(last);
      const dx = p2.X() - p1.X();
      const dy = p2.Y() - p1.Y();
      const dz = p2.Z() - p1.Z();
      const chordLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (chordLen < 1e-12) {
        result = { x: 0, y: 0, z: 1 };
      } else {
        result = { x: dx / chordLen, y: dy / chordLen, z: dz / chordLen };
      }
      p1.delete();
      p2.delete();
    } else {
      const normalized = tangent.Normalized();
      result = { x: normalized.X(), y: normalized.Y(), z: normalized.Z() };
      normalized.delete();
    }

    tangent.delete();
    curve.delete();
    edgeMap.delete();

    return result;
  }

  /**
   * Get the surface normal at the parametric center of a face.
   * Returns a normalized direction accounting for face orientation.
   */
  async getFaceNormal(
    shape: TopoDS_Shape,
    faceIndex: number,
  ): Promise<{ x: number; y: number; z: number }> {
    const oc = await this.getOC();

    const faceMap = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, faceMap);
    const count = faceMap.Size();

    if (faceIndex < 1 || faceIndex > count) {
      faceMap.delete();
      throw new Error(`[OpenCascadeService] getFaceNormal: faceIndex ${faceIndex} out of range [1, ${count}]`);
    }

    const faceShape = faceMap.FindKey(faceIndex);
    const face = oc.TopoDS.Face_1(faceShape);

    const surface = new oc.BRepAdaptor_Surface_2(face, true);

    const uMid = (surface.FirstUParameter() + surface.LastUParameter()) / 2;
    const vMid = (surface.FirstVParameter() + surface.LastVParameter()) / 2;

    const pnt = new oc.gp_Pnt_1();
    const d1u = new oc.gp_Vec_1();
    const d1v = new oc.gp_Vec_1();
    surface.D1(uMid, vMid, pnt, d1u, d1v);

    const normal = d1u.Crossed(d1v);
    const mag = normal.Magnitude();

    let result: { x: number; y: number; z: number };
    if (mag < 1e-12) {
      result = { x: 0, y: 0, z: 1 };
    } else {
      const normalized = normal.Normalized();
      result = { x: normalized.X(), y: normalized.Y(), z: normalized.Z() };
      normalized.delete();
    }

    if (face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED) {
      result = { x: -result.x, y: -result.y, z: -result.z };
    }

    normal.delete();
    d1u.delete();
    d1v.delete();
    pnt.delete();
    surface.delete();
    faceMap.delete();

    return result;
  }
}
