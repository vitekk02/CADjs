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
import type { Sketch, SketchPrimitive, SketchLine, SketchCircle, SketchArc, SketchConversionResult, SketchPlaneType } from "../types/sketch-types";

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
   * Validate sketch primitives for degenerate geometry.
   * Returns true if valid, false if invalid geometry is detected.
   */
  private validateSketch(
    primitives: SketchPrimitive[],
    pointMap: Map<string, { x: number; y: number }>
  ): boolean {
    const EPSILON = 1e-6;

    for (const prim of primitives) {
      if (prim.type === "circle") {
        const circle = prim as SketchCircle;
        if (circle.radius <= EPSILON) {
          console.warn(`[SketchToBrepService] Invalid circle radius: ${circle.radius} (id: ${circle.id})`);
          return false;
        }
      } else if (prim.type === "line") {
        const line = prim as SketchLine;
        const p1 = pointMap.get(line.p1Id);
        const p2 = pointMap.get(line.p2Id);
        if (p1 && p2) {
          const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          if (length < EPSILON) {
            console.warn(`[SketchToBrepService] Degenerate line detected (length: ${length}, id: ${line.id})`);
            return false;
          }
        }
      } else if (prim.type === "arc") {
        const arc = prim as SketchArc;
        if (arc.radius <= EPSILON) {
          console.warn(`[SketchToBrepService] Invalid arc radius: ${arc.radius} (id: ${arc.id})`);
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Convert a sketch to BRep.
   *
   * Process:
   * 1. Build point coordinate map from sketch primitives
   * 2. Validate primitives for degenerate geometry
   * 3. Convert circles to individual faces (self-closing)
   * 4. Convert lines/arcs to a single wire, then face
   * 5. Union all faces together if multiple exist
   */
  async convertSketchToBrep(sketch: Sketch): Promise<Brep> {
    if (!sketch.primitives || sketch.primitives.length === 0) {
      console.warn("[SketchToBrepService] Empty sketch");
      return new Brep([], [], []);
    }

    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    try {
      // Filter out construction primitives before conversion
      const nonConstructionPrimitives = sketch.primitives.filter(
        p => !(p as any).construction
      );

      const pointMap = this.buildPointMap(sketch.primitives); // Keep all points for reference

      // Validate sketch geometry
      if (!this.validateSketch(nonConstructionPrimitives, pointMap)) {
        console.warn("[SketchToBrepService] Sketch validation failed - invalid geometry detected");
        return new Brep([], [], []);
      }
      const { circleEdges, otherEdges } = this.buildEdges(oc, nonConstructionPrimitives, pointMap);

      console.log(`[SketchToBrepService] Created ${circleEdges.length} circle edges and ${otherEdges.length} other edges`);

      const faces = this.buildFaces(oc, circleEdges, otherEdges);

      if (faces.length === 0) {
        console.warn("[SketchToBrepService] No faces created");
        return new Brep([], [], []);
      }

      let resultShape = this.unionFaces(oc, faces);

      // Transform from XY to the target sketch plane
      resultShape = this.transformShapeToPlane(oc, resultShape, sketch.plane.type);

      const brep = await ocService.ocShapeToBRep(resultShape);

      console.log(`[SketchToBrepService] Built BRep with ${brep.faces.length} faces, ${brep.vertices.length} vertices`);
      return brep;
    } catch (error) {
      console.error("[SketchToBrepService] Conversion failed:", error);
      return new Brep([], [], []);
    }
  }

  /**
   * Convert a sketch to multiple profiles (Fusion 360-style).
   *
   * When primitives intersect (e.g., circle overlapping rectangle edge),
   * this creates separate profiles for each closed region:
   * - The crescent (outer part of circle outside the rectangle)
   * - The lens shape (inner part of circle inside the rectangle)
   * - The rectangle with a "bite" taken out
   *
   * Process:
   * 1. Build ALL edges from sketch primitives (circles + lines + arcs)
   * 2. Split ALL edges at their intersection points (using OpenCascade Splitter)
   * 3. Use BOPAlgo_BuilderFace to find all closed regions from split edges
   * 4. Convert each face to a separate Brep profile
   */
  async convertSketchToProfiles(sketch: Sketch): Promise<SketchConversionResult> {
    if (!sketch.primitives || sketch.primitives.length === 0) {
      console.warn("[SketchToBrepService] Empty sketch");
      return { profiles: [], success: false };
    }

    const ocService = OpenCascadeService.getInstance();
    const oc = await ocService.getOC();

    try {
      // Filter out construction primitives before conversion
      const nonConstructionPrimitives = sketch.primitives.filter(
        p => !(p as any).construction
      );

      const pointMap = this.buildPointMap(sketch.primitives); // Keep all points for reference

      // Validate sketch geometry
      if (!this.validateSketch(nonConstructionPrimitives, pointMap)) {
        console.warn("[SketchToBrepService] Sketch validation failed");
        return { profiles: [], success: false };
      }

      const { circleEdges, otherEdges } = this.buildEdges(oc, nonConstructionPrimitives, pointMap);
      console.log(`[SketchToBrepService] Created ${circleEdges.length} circle edges and ${otherEdges.length} other edges`);

      // Combine ALL edges for intersection detection
      const allEdges = [...circleEdges, ...otherEdges];

      if (allEdges.length === 0) {
        console.warn("[SketchToBrepService] No edges to process");
        return { profiles: [], success: false };
      }

      // Use BOPAlgo_Tools.EdgesToWires + WiresToFaces to detect all closed regions
      // This automatically:
      // 1. Computes intersections between edges (circle vs lines)
      // 2. Splits edges at intersection points
      // 3. Finds all minimal closed regions (profiles)
      console.log("[SketchToBrepService] Detecting profile regions using BOPAlgo_Tools...");

      const faces = await ocService.detectProfileRegions(allEdges);
      console.log(`[SketchToBrepService] detectProfileRegions found ${faces.length} faces`);

      // If detectProfileRegions didn't work, fallback to separate processing
      let finalFaces = faces;
      if (faces.length === 0) {
        console.log("[SketchToBrepService] Falling back to separate processing (no intersections detected)");
        finalFaces = this.buildFaces(oc, circleEdges, otherEdges);
        console.log(`[SketchToBrepService] Built ${finalFaces.length} faces (separate processing)`);
      }

      if (finalFaces.length === 0) {
        console.warn("[SketchToBrepService] No faces created");
        return { profiles: [], success: false };
      }

      // Transform faces from XY to the target sketch plane
      if (sketch.plane.type !== "XY") {
        finalFaces = finalFaces.map(face => {
          const transformed = this.transformShapeToPlane(oc, face, sketch.plane.type);
          return oc.TopoDS.Face_1(transformed);
        });
      }

      // Convert each face to a separate profile
      const profiles = await this.facesToProfiles(finalFaces, sketch.id, ocService);
      console.log(`[SketchToBrepService] Created ${profiles.length} profiles`);

      return { profiles, success: profiles.length > 0 };

    } catch (error) {
      console.error("[SketchToBrepService] Profile conversion failed:", error);
      return { profiles: [], success: false };
    }
  }

  /**
   * Convert OpenCascade faces to profile objects with Breps.
   * BReps are centered at origin with the center position stored separately.
   */
  private async facesToProfiles(
    faces: TopoDS_Face[],
    sketchId: string,
    ocService: OpenCascadeService
  ): Promise<SketchConversionResult["profiles"]> {
    const profiles: SketchConversionResult["profiles"] = [];

    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];

      try {
        // Calculate face area
        const area = await ocService.calculateFaceArea(face);

        // Skip very small faces (likely numerical artifacts)
        if (Math.abs(area) < 1e-6) {
          console.log(`[SketchToBrepService] Skipping tiny face ${i} with area ${area}`);
          continue;
        }

        // Convert face to centered Brep + center offset in a single pass
        const { brep, center } = await ocService.faceToBrepWithCenter(face);

        if (brep.faces.length === 0) {
          console.warn(`[SketchToBrepService] Face ${i} produced empty Brep`);
          continue;
        }

        profiles.push({
          id: `${sketchId}_profile_${i}`,
          brep,
          area: Math.abs(area),
          isOuter: area < 0,  // Negative area indicates counterclockwise (outer boundary)
          center
        });

        console.log(`[SketchToBrepService] Created profile ${i}: area=${area.toFixed(4)}, center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
      } catch (error) {
        console.error(`[SketchToBrepService] Failed to convert face ${i}:`, error);
      }
    }

    return profiles;
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
   * Normalize a point to a string key for graph operations.
   */
  private pointToKey(p: [number, number, number]): string {
    // Round to avoid floating point issues
    const precision = 1e-4;
    const x = Math.round(p[0] / precision) * precision;
    const y = Math.round(p[1] / precision) * precision;
    const z = Math.round(p[2] / precision) * precision;
    return `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
  }

  /**
   * Half-edge structure for planar face detection.
   */
  private createHalfEdgeStructure(
    oc: OpenCascadeInstance,
    edges: TopoDS_Edge[]
  ): {
    halfEdges: Array<{
      id: number;
      startKey: string;
      endKey: string;
      startCoords: [number, number];
      endCoords: [number, number];
      edge: TopoDS_Edge;
      angle: number;
      twinId: number;
      nextId: number | null;
      visited: boolean;
    }>;
    vertexOutgoing: Map<string, number[]>;
  } {
    type HalfEdge = {
      id: number;
      startKey: string;
      endKey: string;
      startCoords: [number, number];
      endCoords: [number, number];
      edge: TopoDS_Edge;
      angle: number;
      twinId: number;
      nextId: number | null;
      visited: boolean;
    };

    const halfEdges: HalfEdge[] = [];
    const vertexOutgoing: Map<string, number[]> = new Map();

    let heId = 0;
    for (const edge of edges) {
      const endpoints = this.getEdgeEndpoints(oc, edge);
      if (!endpoints) continue;

      const startKey = this.pointToKey(endpoints.start);
      const endKey = this.pointToKey(endpoints.end);

      const dx = endpoints.end[0] - endpoints.start[0];
      const dy = endpoints.end[1] - endpoints.start[1];
      const forwardAngle = Math.atan2(dy, dx);
      const reverseAngle = Math.atan2(-dy, -dx);

      const forwardId = heId++;
      const reverseId = heId++;

      halfEdges.push({
        id: forwardId,
        startKey,
        endKey,
        startCoords: [endpoints.start[0], endpoints.start[1]],
        endCoords: [endpoints.end[0], endpoints.end[1]],
        edge,
        angle: forwardAngle,
        twinId: reverseId,
        nextId: null,
        visited: false,
      });

      halfEdges.push({
        id: reverseId,
        startKey: endKey,
        endKey: startKey,
        startCoords: [endpoints.end[0], endpoints.end[1]],
        endCoords: [endpoints.start[0], endpoints.start[1]],
        edge,
        angle: reverseAngle,
        twinId: forwardId,
        nextId: null,
        visited: false,
      });

      if (!vertexOutgoing.has(startKey)) vertexOutgoing.set(startKey, []);
      if (!vertexOutgoing.has(endKey)) vertexOutgoing.set(endKey, []);
      vertexOutgoing.get(startKey)!.push(forwardId);
      vertexOutgoing.get(endKey)!.push(reverseId);
    }

    // Sort outgoing half-edges by angle at each vertex
    for (const [, outgoing] of vertexOutgoing) {
      outgoing.sort((a, b) => halfEdges[a].angle - halfEdges[b].angle);
    }

    // Link "next" pointers using leftmost turn rule
    for (const he of halfEdges) {
      const endVertex = he.endKey;
      const outgoing = vertexOutgoing.get(endVertex);
      if (!outgoing || outgoing.length === 0) continue;

      // Incoming angle is the reverse of the twin's angle
      const incomingAngle = halfEdges[he.twinId].angle;

      // Find the next half-edge with smallest counterclockwise turn
      let bestNextId: number | null = null;
      let bestDelta = Infinity;

      for (const candidateId of outgoing) {
        if (candidateId === he.twinId) continue; // Don't go back

        let delta = halfEdges[candidateId].angle - incomingAngle;
        if (delta <= 1e-9) delta += 2 * Math.PI; // Wrap around

        if (delta < bestDelta) {
          bestDelta = delta;
          bestNextId = candidateId;
        }
      }

      he.nextId = bestNextId;
    }

    return { halfEdges, vertexOutgoing };
  }

  /**
   * Calculate signed area of a cycle (positive = counterclockwise = interior face).
   */
  private calculateSignedArea(coords: Array<[number, number]>): number {
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[(i + 1) % coords.length];
      area += (x1 * y2 - x2 * y1);
    }
    return area / 2;
  }

  /**
   * Find all minimal faces using planar graph traversal with "leftmost turn" rule.
   * This correctly handles shared edges (like house shape with interior line).
   */
  private findClosedLoops(
    oc: OpenCascadeInstance,
    edges: TopoDS_Edge[]
  ): TopoDS_Edge[][] {
    if (edges.length === 0) return [];
    if (edges.length < 3) return []; // Need at least 3 edges for a face

    const { halfEdges } = this.createHalfEdgeStructure(oc, edges);

    console.log(`[SketchToBrepService] Created ${halfEdges.length} half-edges from ${edges.length} edges`);

    const faceEdgeLists: TopoDS_Edge[][] = [];

    // Traverse cycles starting from each unvisited half-edge
    for (const startHe of halfEdges) {
      if (startHe.visited) continue;

      const cycleHalfEdges: typeof halfEdges = [];
      const cycleCoords: Array<[number, number]> = [];
      let current = startHe;
      let safety = 0;

      while (!current.visited && safety < halfEdges.length * 2) {
        current.visited = true;
        cycleHalfEdges.push(current);
        cycleCoords.push(current.startCoords);

        if (current.nextId === null) break;
        current = halfEdges[current.nextId];
        safety++;

        // Check if we've completed a cycle
        if (current.id === startHe.id) break;
      }

      // Valid cycle must have at least 3 edges and return to start
      if (cycleHalfEdges.length >= 3 && current.id === startHe.id) {
        const area = this.calculateSignedArea(cycleCoords);

        // Positive area = counterclockwise = interior face (not the outer boundary)
        if (area > 1e-9) {
          // Collect unique edges from this cycle
          const edgeSet = new Set<TopoDS_Edge>();
          for (const he of cycleHalfEdges) {
            edgeSet.add(he.edge);
          }
          const edgeList = Array.from(edgeSet);
          faceEdgeLists.push(edgeList);

          console.log(`[SketchToBrepService] Found face with ${edgeList.length} edges (area=${area.toFixed(2)})`);
        } else {
          console.log(`[SketchToBrepService] Skipping outer boundary (area=${area.toFixed(2)})`);
        }
      }
    }

    console.log(`[SketchToBrepService] Found ${faceEdgeLists.length} interior face(s)`);
    return faceEdgeLists;
  }

  /**
   * Build faces from edges.
   * Finds individual closed loops (cycles) within the edges, handling cases
   * where multiple loops share edges (like a house shape with interior line).
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

    // Find closed loops (cycles) - handles shapes with shared edges
    const loops = this.findClosedLoops(oc, otherEdges);

    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i];
      console.log(`[SketchToBrepService] Processing loop ${i + 1} with ${loop.length} edges`);

      const wire = this.buildWire(oc, loop);
      if (wire?.Closed_1()) {
        const face = this.wireToFace(oc, wire);
        if (face) {
          faces.push(face);
          console.log(`[SketchToBrepService] Loop ${i + 1} created a face`);
        }
      } else if (wire) {
        console.warn(`[SketchToBrepService] Loop ${i + 1} wire is not closed`);
      } else {
        console.warn(`[SketchToBrepService] Loop ${i + 1} failed to build wire`);
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
  ): any {
    if (faces.length === 1) return faces[0];

    let result: any = faces[0];
    for (let i = 1; i < faces.length; i++) {
      let fuser: any = null;
      let progressRange: any = null;
      try {
        progressRange = new oc.Message_ProgressRange_1();
        fuser = new oc.BRepAlgoAPI_Fuse_3(result, faces[i], progressRange);
        if (fuser.IsDone()) {
          result = fuser.Shape();
        }
      } catch (error) {
        console.warn(`[SketchToBrepService] Failed to fuse face ${i + 1}:`, error);
      } finally {
        fuser?.delete();
        progressRange?.delete();
      }
    }
    return result;
  }

  /**
   * Convert a single edge to a face (for self-closing edges like circles).
   */
  private edgeToFace(oc: OpenCascadeInstance, edge: TopoDS_Edge): TopoDS_Face | null {
    let wireBuilder: ReturnType<typeof oc.BRepBuilderAPI_MakeWire_1> | null = null;
    let faceBuilder: ReturnType<typeof oc.BRepBuilderAPI_MakeFace_15> | null = null;
    try {
      wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
      wireBuilder.Add_1(edge);
      if (!wireBuilder.IsDone()) return null;

      faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wireBuilder.Wire(), true);
      return faceBuilder.IsDone() ? faceBuilder.Face() : null;
    } catch {
      return null;
    } finally {
      wireBuilder?.delete();
      faceBuilder?.delete();
    }
  }

  /**
   * Get the start and end vertices of an edge as [x,y,z] arrays.
   */
  private getEdgeEndpoints(
    oc: OpenCascadeInstance,
    edge: TopoDS_Edge
  ): { start: [number, number, number]; end: [number, number, number] } | null {
    try {
      const explorer = new oc.TopExp_Explorer_2(
        edge,
        oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      );

      const vertices: [number, number, number][] = [];
      while (explorer.More()) {
        const vertex = oc.TopoDS.Vertex_1(explorer.Current());
        const pnt = oc.BRep_Tool.Pnt(vertex);
        vertices.push([pnt.X(), pnt.Y(), pnt.Z()]);
        pnt.delete();
        explorer.Next();
      }
      explorer.delete();

      if (vertices.length >= 2) {
        return { start: vertices[0], end: vertices[1] };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if two points are approximately equal within tolerance.
   * Uses a larger tolerance (1e-4) to handle floating point precision from user drawing.
   */
  private pointsEqual(
    p1: [number, number, number],
    p2: [number, number, number],
    tolerance = 1e-4
  ): boolean {
    return (
      Math.abs(p1[0] - p2[0]) < tolerance &&
      Math.abs(p1[1] - p2[1]) < tolerance &&
      Math.abs(p1[2] - p2[2]) < tolerance
    );
  }

  /**
   * Sort edges to form a connected chain.
   * Returns sorted edges, or original array if no valid chain found.
   */
  private sortEdgesForWire(
    oc: OpenCascadeInstance,
    edges: TopoDS_Edge[]
  ): { sorted: TopoDS_Edge[]; chainStart: [number, number, number] | null; chainEnd: [number, number, number] | null } {
    if (edges.length === 0) return { sorted: [], chainStart: null, chainEnd: null };
    if (edges.length === 1) {
      const endpoints = this.getEdgeEndpoints(oc, edges[0]);
      return {
        sorted: edges,
        chainStart: endpoints?.start || null,
        chainEnd: endpoints?.end || null
      };
    }

    // Get endpoints for all edges
    const edgeData = edges.map((edge, index) => ({
      edge,
      index,
      endpoints: this.getEdgeEndpoints(oc, edge),
    }));

    // Log all edge endpoints for debugging
    console.log("[SketchToBrepService] Edge endpoints:");
    edgeData.forEach((e, i) => {
      if (e.endpoints) {
        console.log(`  Edge ${i}: [${e.endpoints.start.map(n => n.toFixed(4)).join(", ")}] → [${e.endpoints.end.map(n => n.toFixed(4)).join(", ")}]`);
      }
    });

    // Filter out edges where we couldn't get endpoints
    const validEdges = edgeData.filter((e) => e.endpoints !== null);
    if (validEdges.length !== edges.length) {
      console.warn("[SketchToBrepService] Could not get endpoints for some edges");
      return { sorted: edges, chainStart: null, chainEnd: null };
    }

    // Build chain starting from first edge
    const sorted: TopoDS_Edge[] = [validEdges[0].edge];
    const used = new Set<number>([0]);
    let chainStart = validEdges[0].endpoints!.start;
    let currentEnd = validEdges[0].endpoints!.end;

    // Try to chain edges
    while (sorted.length < validEdges.length) {
      let foundNext = false;

      for (let i = 0; i < validEdges.length; i++) {
        if (used.has(i)) continue;

        const { start, end } = validEdges[i].endpoints!;

        // Check if this edge connects to current chain end
        if (this.pointsEqual(currentEnd, start)) {
          sorted.push(validEdges[i].edge);
          used.add(i);
          currentEnd = end;
          foundNext = true;
          break;
        }
        // Check reversed direction
        if (this.pointsEqual(currentEnd, end)) {
          sorted.push(validEdges[i].edge);
          used.add(i);
          currentEnd = start;
          foundNext = true;
          break;
        }
      }

      if (!foundNext) {
        console.warn(
          `[SketchToBrepService] Could not find connected edge at position ${sorted.length}. ` +
          `Looking for edge starting at [${currentEnd.map(n => n.toFixed(6)).join(", ")}]`
        );
        // Log remaining unused edges
        for (let i = 0; i < validEdges.length; i++) {
          if (!used.has(i)) {
            const { start, end } = validEdges[i].endpoints!;
            console.warn(`  Unused edge ${i}: [${start.map(n => n.toFixed(6)).join(", ")}] → [${end.map(n => n.toFixed(6)).join(", ")}]`);
          }
        }
        return { sorted: edges, chainStart: null, chainEnd: null };
      }
    }

    // Check if chain is closed
    const isClosed = this.pointsEqual(currentEnd, chainStart);
    console.log(`[SketchToBrepService] Sorted ${sorted.length} edges. Chain: [${chainStart.map(n => n.toFixed(4)).join(", ")}] → [${currentEnd.map(n => n.toFixed(4)).join(", ")}], closed=${isClosed}`);

    return { sorted, chainStart, chainEnd: currentEnd };
  }

  /**
   * Build a wire from multiple edges.
   * Edges are sorted to form a connected chain before building.
   */
  private buildWire(oc: OpenCascadeInstance, edges: TopoDS_Edge[]): TopoDS_Wire | null {
    if (edges.length === 0) return null;

    // Sort edges to form connected chain
    const { sorted: sortedEdges, chainStart, chainEnd } = this.sortEdgesForWire(oc, edges);

    // Check if chain should be closed but has small gap
    if (chainStart && chainEnd && !this.pointsEqual(chainStart, chainEnd)) {
      const gap = Math.sqrt(
        (chainEnd[0] - chainStart[0]) ** 2 +
        (chainEnd[1] - chainStart[1]) ** 2 +
        (chainEnd[2] - chainStart[2]) ** 2
      );
      console.warn(`[SketchToBrepService] Chain has gap of ${gap.toFixed(6)} between end and start`);
    }

    let wireBuilder: ReturnType<typeof oc.BRepBuilderAPI_MakeWire_1> | null = null;
    try {
      wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
      for (let i = 0; i < sortedEdges.length; i++) {
        wireBuilder.Add_1(sortedEdges[i]);
        const error = wireBuilder.Error();
        if (error !== oc.BRepBuilderAPI_WireError.BRepBuilderAPI_WireDone) {
          console.warn(`[SketchToBrepService] Wire builder error after edge ${i}: ${error}`);
        }
      }

      if (!wireBuilder.IsDone()) {
        console.warn("[SketchToBrepService] Wire builder failed");
        return null;
      }

      const wire = wireBuilder.Wire();
      console.log(`[SketchToBrepService] Built wire, closed=${wire.Closed_1()}`);
      return wire;
    } catch (error) {
      console.warn("[SketchToBrepService] Wire building failed:", error);
      return null;
    } finally {
      wireBuilder?.delete();
    }
  }

  /**
   * Convert a wire to a planar face.
   */
  private wireToFace(oc: OpenCascadeInstance, wire: TopoDS_Wire): TopoDS_Face | null {
    let faceBuilder: ReturnType<typeof oc.BRepBuilderAPI_MakeFace_15> | null = null;
    try {
      faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
      return faceBuilder.IsDone() ? faceBuilder.Face() : null;
    } catch {
      return null;
    } finally {
      faceBuilder?.delete();
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
    let builder: ReturnType<typeof oc.BRepBuilderAPI_MakeEdge_3> | null = null;

    try {
      builder = new oc.BRepBuilderAPI_MakeEdge_3(gp1, gp2);
      return builder.IsDone() ? builder.Edge() : null;
    } finally {
      gp1.delete();
      gp2.delete();
      builder?.delete();
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
    let builder: ReturnType<typeof oc.BRepBuilderAPI_MakeEdge_8> | null = null;

    try {
      builder = new oc.BRepBuilderAPI_MakeEdge_8(gpCircle);
      return builder.IsDone() ? builder.Edge() : null;
    } finally {
      gpCenter.delete();
      dir.delete();
      axis.delete();
      gpCircle.delete();
      builder?.delete();
    }
  }

  /**
   * Transform an OCC shape from XY plane to the target sketch plane.
   * Sketch geometry is always built in XY; this rotates it to XZ or YZ as needed.
   */
  private transformShapeToPlane(
    oc: OpenCascadeInstance,
    shape: any,
    planeType: SketchPlaneType
  ): any {
    if (planeType === "XY") return shape;

    const trsf = new oc.gp_Trsf_1();

    if (planeType === "XZ") {
      // Rotate -90° around X axis: (x,y,0) → (x,0,y)
      const axis = new oc.gp_Ax1_2(
        new oc.gp_Pnt_3(0, 0, 0),
        new oc.gp_Dir_4(1, 0, 0)
      );
      trsf.SetRotation_1(axis, -Math.PI / 2);
      axis.delete();
    } else if (planeType === "YZ") {
      // Rotate 90° around Z axis then -90° around X axis: (x,y,0) → (0,x,y)
      // Use SetValues to set the full rotation matrix directly
      trsf.SetValues(
        0, 0, 1, 0,
        1, 0, 0, 0,
        0, 1, 0, 0
      );
    }

    let transformer: any = null;
    try {
      transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
      if (transformer.IsDone()) {
        const result = transformer.Shape();
        return result;
      }
      console.warn("[SketchToBrepService] Plane transform failed, using original shape");
      return shape;
    } catch (error) {
      console.warn("[SketchToBrepService] Plane transform error:", error);
      return shape;
    } finally {
      trsf.delete();
      transformer?.delete();
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
    let builder: ReturnType<typeof oc.BRepBuilderAPI_MakeEdge_9> | null = null;

    try {
      builder = new oc.BRepBuilderAPI_MakeEdge_9(circle, startAngle, endAngle);
      return builder.IsDone() ? builder.Edge() : null;
    } finally {
      gpCenter.delete();
      dir.delete();
      axis.delete();
      circle.delete();
      builder?.delete();
    }
  }
}
