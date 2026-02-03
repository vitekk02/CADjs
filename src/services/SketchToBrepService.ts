/**
 * Sketch to BRep Conversion Service
 *
 * Converts 2D sketch primitives (points, lines, circles, arcs) into
 * 3D BRep geometry using OpenCascade's wire and face building APIs.
 *
 * @module services/SketchToBrepService
 */

import type { OpenCascadeInstance, TopoDS_Edge, TopoDS_Wire, TopoDS_Face } from "opencascade.js";
import { Brep } from "../geometry";
import { OpenCascadeService } from "./OpenCascadeService";
import type { Sketch, SketchPrimitive, SketchLine, SketchCircle, SketchArc } from "../types/sketch-types";

/**
 * Singleton service that converts sketches to BRep using OpenCascade.
 */
export class SketchToBrepService {
  private static instance: SketchToBrepService;

  private constructor() {}

  static getInstance(): SketchToBrepService {
    if (!SketchToBrepService.instance) {
      SketchToBrepService.instance = new SketchToBrepService();
    }
    return SketchToBrepService.instance;
  }

  /**
   * Convert a sketch to BRep.
   *
   * Process:
   * 1. Build point coordinate map from sketch primitives
   * 2. Convert circles to individual faces (self-closing)
   * 3. Convert lines/arcs to a single wire, then face
   * 4. Union all faces together if multiple exist
   */
  async convertSketchToBrep(sketch: Sketch): Promise<Brep> {
    if (!sketch.primitives || sketch.primitives.length === 0) {
      console.warn("[SketchToBrepService] Empty sketch");
      return new Brep([], [], []);
    }

    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    try {
      const pointMap = this.buildPointMap(sketch.primitives);
      const { circleEdges, otherEdges } = this.buildEdges(oc, sketch.primitives, pointMap);

      console.log(`[SketchToBrepService] Created ${circleEdges.length} circle edges and ${otherEdges.length} other edges`);

      const faces = this.buildFaces(oc, circleEdges, otherEdges);

      if (faces.length === 0) {
        console.warn("[SketchToBrepService] No faces created");
        return new Brep([], [], []);
      }

      const resultShape = this.unionFaces(oc, faces);
      const brep = await ocService.ocShapeToBRep(resultShape);

      console.log(`[SketchToBrepService] Built BRep with ${brep.faces.length} faces, ${brep.vertices.length} vertices`);
      return brep;
    } catch (error) {
      console.error("[SketchToBrepService] Conversion failed:", error);
      return new Brep([], [], []);
    }
  }

  /**
   * Build a map of point IDs to coordinates.
   */
  private buildPointMap(primitives: SketchPrimitive[]): Map<string, { x: number; y: number }> {
    const pointMap = new Map<string, { x: number; y: number }>();
    for (const prim of primitives) {
      if (prim.type === "point") {
        pointMap.set(prim.id, { x: prim.x, y: prim.y });
      }
    }
    return pointMap;
  }

  /**
   * Build OpenCascade edges from sketch primitives.
   * Separates circles (self-closing) from other edges.
   */
  private buildEdges(
    oc: OpenCascadeInstance,
    primitives: SketchPrimitive[],
    pointMap: Map<string, { x: number; y: number }>
  ): { circleEdges: TopoDS_Edge[]; otherEdges: TopoDS_Edge[] } {
    const circleEdges: TopoDS_Edge[] = [];
    const otherEdges: TopoDS_Edge[] = [];

    for (const prim of primitives) {
      if (prim.type === "circle") {
        const edge = this.circleToEdge(oc, prim as SketchCircle, pointMap);
        if (edge) circleEdges.push(edge);
      } else if (prim.type === "line") {
        const edge = this.lineToEdge(oc, prim as SketchLine, pointMap);
        if (edge) otherEdges.push(edge);
      } else if (prim.type === "arc") {
        const edge = this.arcToEdge(oc, prim as SketchArc, pointMap);
        if (edge) otherEdges.push(edge);
      }
    }

    return { circleEdges, otherEdges };
  }

  /**
   * Build faces from edges.
   */
  private buildFaces(
    oc: OpenCascadeInstance,
    circleEdges: TopoDS_Edge[],
    otherEdges: TopoDS_Edge[]
  ): TopoDS_Face[] {
    const faces: TopoDS_Face[] = [];

    // Each circle is its own closed face
    for (const edge of circleEdges) {
      const face = this.edgeToFace(oc, edge);
      if (face) faces.push(face);
    }

    // Lines/arcs form a single wire -> face
    if (otherEdges.length > 0) {
      const wire = this.buildWire(oc, otherEdges);
      if (wire?.Closed_1()) {
        const face = this.wireToFace(oc, wire);
        if (face) faces.push(face);
      } else if (wire) {
        console.warn("[SketchToBrepService] Wire is not closed");
      }
    }

    return faces;
  }

  /**
   * Union multiple faces into a single shape.
   */
  private unionFaces(
    oc: OpenCascadeInstance,
    faces: TopoDS_Face[]
  ): TopoDS_Face | ReturnType<typeof oc.BRepAlgoAPI_Fuse_3.prototype.Shape> {
    if (faces.length === 1) return faces[0];

    let result: TopoDS_Face | ReturnType<typeof oc.BRepAlgoAPI_Fuse_3.prototype.Shape> = faces[0];
    for (let i = 1; i < faces.length; i++) {
      try {
        const fuser = new oc.BRepAlgoAPI_Fuse_3(result, faces[i], new oc.Message_ProgressRange_1());
        if (fuser.IsDone()) {
          result = fuser.Shape();
        }
      } catch (error) {
        console.warn(`[SketchToBrepService] Failed to fuse face ${i + 1}:`, error);
      }
    }
    return result;
  }

  /**
   * Convert a single edge to a face (for self-closing edges like circles).
   */
  private edgeToFace(oc: OpenCascadeInstance, edge: TopoDS_Edge): TopoDS_Face | null {
    try {
      const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
      wireBuilder.Add_1(edge);
      if (!wireBuilder.IsDone()) return null;

      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wireBuilder.Wire(), true);
      return faceBuilder.IsDone() ? faceBuilder.Face() : null;
    } catch {
      return null;
    }
  }

  /**
   * Build a wire from multiple edges.
   */
  private buildWire(oc: OpenCascadeInstance, edges: TopoDS_Edge[]): TopoDS_Wire | null {
    try {
      const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
      for (const edge of edges) {
        wireBuilder.Add_1(edge);
      }
      return wireBuilder.IsDone() ? wireBuilder.Wire() : null;
    } catch {
      return null;
    }
  }

  /**
   * Convert a wire to a planar face.
   */
  private wireToFace(oc: OpenCascadeInstance, wire: TopoDS_Wire): TopoDS_Face | null {
    try {
      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
      return faceBuilder.IsDone() ? faceBuilder.Face() : null;
    } catch {
      return null;
    }
  }

  /**
   * Convert a line primitive to an OpenCascade edge.
   */
  private lineToEdge(
    oc: OpenCascadeInstance,
    line: SketchLine,
    pointMap: Map<string, { x: number; y: number }>
  ): TopoDS_Edge | null {
    const p1 = pointMap.get(line.p1Id);
    const p2 = pointMap.get(line.p2Id);
    if (!p1 || !p2) return null;

    const gp1 = new oc.gp_Pnt_3(p1.x, p1.y, 0);
    const gp2 = new oc.gp_Pnt_3(p2.x, p2.y, 0);

    try {
      const builder = new oc.BRepBuilderAPI_MakeEdge_3(gp1, gp2);
      return builder.IsDone() ? builder.Edge() : null;
    } finally {
      gp1.delete();
      gp2.delete();
    }
  }

  /**
   * Convert a circle primitive to an OpenCascade edge.
   */
  private circleToEdge(
    oc: OpenCascadeInstance,
    circle: SketchCircle,
    pointMap: Map<string, { x: number; y: number }>
  ): TopoDS_Edge | null {
    const center = pointMap.get(circle.centerId);
    if (!center) return null;

    const gpCenter = new oc.gp_Pnt_3(center.x, center.y, 0);
    const dir = new oc.gp_Dir_4(0, 0, 1);
    const axis = new oc.gp_Ax2_3(gpCenter, dir);
    const gpCircle = new oc.gp_Circ_2(axis, circle.radius);

    try {
      const builder = new oc.BRepBuilderAPI_MakeEdge_8(gpCircle);
      return builder.IsDone() ? builder.Edge() : null;
    } finally {
      gpCenter.delete();
      dir.delete();
      axis.delete();
      gpCircle.delete();
    }
  }

  /**
   * Convert an arc primitive to an OpenCascade edge.
   */
  private arcToEdge(
    oc: OpenCascadeInstance,
    arc: SketchArc,
    pointMap: Map<string, { x: number; y: number }>
  ): TopoDS_Edge | null {
    const center = pointMap.get(arc.centerId);
    const start = pointMap.get(arc.startId);
    const end = pointMap.get(arc.endId);
    if (!center || !start || !end) return null;

    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    const radius = Math.sqrt((start.x - center.x) ** 2 + (start.y - center.y) ** 2);

    const gpCenter = new oc.gp_Pnt_3(center.x, center.y, 0);
    const dir = new oc.gp_Dir_4(0, 0, 1);
    const axis = new oc.gp_Ax2_3(gpCenter, dir);
    const circle = new oc.gp_Circ_2(axis, radius);

    try {
      const builder = new oc.BRepBuilderAPI_MakeEdge_9(circle, startAngle, endAngle);
      return builder.IsDone() ? builder.Edge() : null;
    } finally {
      gpCenter.delete();
      dir.delete();
      axis.delete();
      circle.delete();
    }
  }
}
