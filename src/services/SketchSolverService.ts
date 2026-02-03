import {
  make_gcs_wrapper,
  GcsWrapper,
  Algorithm,
  SolveStatus,
  type SketchPrimitive as GcsSketchPrimitive,
  type SketchPoint as GcsSketchPoint,
  type SketchLine as GcsSketchLine,
  type SketchCircle as GcsSketchCircle,
  type SketchArc as GcsSketchArc,
} from "@salusoft89/planegcs";
import {
  Sketch,
  SketchPrimitive,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchConstraint,
  SolveResult,
  isSketchPoint,
  isSketchLine,
  isSketchCircle,
  isSketchArc,
} from "../types/sketch-types";

export class SketchSolverService {
  private static instance: SketchSolverService;
  private gcsWrapper: GcsWrapper | null = null;
  private initPromise: Promise<GcsWrapper> | null = null;

  private constructor() {}

  static getInstance(): SketchSolverService {
    if (!SketchSolverService.instance) {
      SketchSolverService.instance = new SketchSolverService();
    }
    return SketchSolverService.instance;
  }

  async getGCS(): Promise<GcsWrapper> {
    if (this.gcsWrapper) {
      return this.gcsWrapper;
    }

    if (!this.initPromise) {
      this.initPromise = make_gcs_wrapper();
    }

    try {
      this.gcsWrapper = await this.initPromise;
      return this.gcsWrapper;
    } catch (error) {
      console.error("Error initializing planegcs:", error);
      throw error;
    }
  }

  async solve(sketch: Sketch): Promise<SolveResult> {
    const gcs = await this.getGCS();

    // Clear previous data
    gcs.clear_data();

    // Convert and push primitives
    const gcsPrimitives = this.primitivesToGcsFormat(sketch.primitives);
    gcs.push_primitives_and_params(gcsPrimitives);

    // Convert and push constraints
    const gcsConstraints = this.constraintsToGcsFormat(
      sketch.constraints,
      sketch.primitives,
    );
    for (const constraint of gcsConstraints) {
      gcs.push_primitive(constraint);
    }

    // Solve
    const status = gcs.solve(Algorithm.DogLeg);
    const success =
      status === SolveStatus.Success || status === SolveStatus.Converged;

    if (success) {
      gcs.apply_solution();
    }

    // Get DOF
    const dof = gcs.gcs.dof();

    // Update sketch with solution
    const updatedSketch = this.applyGcsSolution(sketch, gcs);

    // Determine status
    let sketchStatus: "underconstrained" | "fully_constrained" | "overconstrained";
    if (gcs.has_gcs_conflicting_constraints() || gcs.has_gcs_redundant_constraints()) {
      sketchStatus = "overconstrained";
    } else if (dof === 0) {
      sketchStatus = "fully_constrained";
    } else {
      sketchStatus = "underconstrained";
    }

    return {
      success,
      sketch: {
        ...updatedSketch,
        dof,
        status: sketchStatus,
      },
      dof,
      status: sketchStatus,
    };
  }

  async getDOF(sketch: Sketch): Promise<number> {
    const gcs = await this.getGCS();

    // Clear previous data
    gcs.clear_data();

    // Convert and push primitives
    const gcsPrimitives = this.primitivesToGcsFormat(sketch.primitives);
    gcs.push_primitives_and_params(gcsPrimitives);

    // Convert and push constraints
    const gcsConstraints = this.constraintsToGcsFormat(
      sketch.constraints,
      sketch.primitives,
    );
    for (const constraint of gcsConstraints) {
      gcs.push_primitive(constraint);
    }

    return gcs.gcs.dof();
  }

  private primitivesToGcsFormat(primitives: SketchPrimitive[]): GcsSketchPrimitive[] {
    const result: GcsSketchPrimitive[] = [];

    for (const primitive of primitives) {
      if (isSketchPoint(primitive)) {
        result.push(this.pointToGcs(primitive));
      } else if (isSketchLine(primitive)) {
        result.push(this.lineToGcs(primitive));
      } else if (isSketchCircle(primitive)) {
        result.push(this.circleToGcs(primitive));
      } else if (isSketchArc(primitive)) {
        result.push(this.arcToGcs(primitive));
      }
    }

    return result;
  }

  private pointToGcs(point: SketchPoint): GcsSketchPoint {
    return {
      id: point.id,
      type: "point",
      x: point.x,
      y: point.y,
      fixed: point.fixed ?? false,
    };
  }

  private lineToGcs(line: SketchLine): GcsSketchLine {
    return {
      id: line.id,
      type: "line",
      p1_id: line.p1Id,
      p2_id: line.p2Id,
    };
  }

  private circleToGcs(circle: SketchCircle): GcsSketchCircle {
    return {
      id: circle.id,
      type: "circle",
      c_id: circle.centerId,
      radius: circle.radius,
    };
  }

  private arcToGcs(arc: SketchArc): GcsSketchArc {
    return {
      id: arc.id,
      type: "arc",
      c_id: arc.centerId,
      start_id: arc.startId,
      end_id: arc.endId,
      radius: arc.radius,
      start_angle: 0,
      end_angle: Math.PI,
    };
  }

  private constraintsToGcsFormat(
    constraints: SketchConstraint[],
    primitives: SketchPrimitive[],
  ): GcsSketchPrimitive[] {
    const result: GcsSketchPrimitive[] = [];

    for (const constraint of constraints) {
      const gcsConstraint = this.constraintToGcs(constraint, primitives);
      if (gcsConstraint) {
        result.push(gcsConstraint);
      }
    }

    return result;
  }

  private constraintToGcs(
    constraint: SketchConstraint,
    primitives: SketchPrimitive[],
  ): GcsSketchPrimitive | null {
    const driving = constraint.driving ?? true;

    switch (constraint.type) {
      case "coincident": {
        // Point-point coincident
        if (constraint.primitiveIds.length === 2) {
          return {
            id: constraint.id,
            type: "p2p_coincident",
            p1_id: constraint.primitiveIds[0],
            p2_id: constraint.primitiveIds[1],
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "horizontal": {
        // Horizontal line or horizontal distance between points
        if (constraint.primitiveIds.length === 1) {
          return {
            id: constraint.id,
            type: "horizontal_l",
            l_id: constraint.primitiveIds[0],
            driving,
          } as GcsSketchPrimitive;
        } else if (constraint.primitiveIds.length === 2) {
          return {
            id: constraint.id,
            type: "horizontal_pp",
            p1_id: constraint.primitiveIds[0],
            p2_id: constraint.primitiveIds[1],
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "vertical": {
        if (constraint.primitiveIds.length === 1) {
          return {
            id: constraint.id,
            type: "vertical_l",
            l_id: constraint.primitiveIds[0],
            driving,
          } as GcsSketchPrimitive;
        } else if (constraint.primitiveIds.length === 2) {
          return {
            id: constraint.id,
            type: "vertical_pp",
            p1_id: constraint.primitiveIds[0],
            p2_id: constraint.primitiveIds[1],
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "parallel": {
        if (constraint.primitiveIds.length === 2) {
          return {
            id: constraint.id,
            type: "parallel",
            l1_id: constraint.primitiveIds[0],
            l2_id: constraint.primitiveIds[1],
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "perpendicular": {
        if (constraint.primitiveIds.length === 2) {
          return {
            id: constraint.id,
            type: "perpendicular_ll",
            l1_id: constraint.primitiveIds[0],
            l2_id: constraint.primitiveIds[1],
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "tangent": {
        // Line-circle tangent
        if (constraint.primitiveIds.length === 2) {
          const p1 = primitives.find((p) => p.id === constraint.primitiveIds[0]);
          const p2 = primitives.find((p) => p.id === constraint.primitiveIds[1]);

          if (p1 && p2 && isSketchLine(p1) && isSketchCircle(p2)) {
            return {
              id: constraint.id,
              type: "tangent_lc",
              l_id: constraint.primitiveIds[0],
              c_id: constraint.primitiveIds[1],
              driving,
            } as GcsSketchPrimitive;
          } else if (p1 && p2 && isSketchCircle(p1) && isSketchLine(p2)) {
            return {
              id: constraint.id,
              type: "tangent_lc",
              l_id: constraint.primitiveIds[1],
              c_id: constraint.primitiveIds[0],
              driving,
            } as GcsSketchPrimitive;
          }
        }
        break;
      }

      case "equal": {
        // Equal length lines or equal radius circles
        if (constraint.primitiveIds.length === 2) {
          const p1 = primitives.find((p) => p.id === constraint.primitiveIds[0]);
          const p2 = primitives.find((p) => p.id === constraint.primitiveIds[1]);

          if (p1 && p2 && isSketchLine(p1) && isSketchLine(p2)) {
            return {
              id: constraint.id,
              type: "equal_length",
              l1_id: constraint.primitiveIds[0],
              l2_id: constraint.primitiveIds[1],
              driving,
            } as GcsSketchPrimitive;
          } else if (p1 && p2 && isSketchCircle(p1) && isSketchCircle(p2)) {
            return {
              id: constraint.id,
              type: "equal_radius_cc",
              c1_id: constraint.primitiveIds[0],
              c2_id: constraint.primitiveIds[1],
              driving,
            } as GcsSketchPrimitive;
          }
        }
        break;
      }

      case "distance": {
        // Distance between two points
        if (
          constraint.primitiveIds.length === 2 &&
          constraint.value !== undefined
        ) {
          return {
            id: constraint.id,
            type: "p2p_distance",
            p1_id: constraint.primitiveIds[0],
            p2_id: constraint.primitiveIds[1],
            distance: constraint.value,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "distanceX": {
        if (
          constraint.primitiveIds.length === 2 &&
          constraint.value !== undefined
        ) {
          return {
            id: constraint.id,
            type: "difference",
            param1: { o_id: constraint.primitiveIds[0], prop: "x" },
            param2: { o_id: constraint.primitiveIds[1], prop: "x" },
            difference: constraint.value,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "distanceY": {
        if (
          constraint.primitiveIds.length === 2 &&
          constraint.value !== undefined
        ) {
          return {
            id: constraint.id,
            type: "difference",
            param1: { o_id: constraint.primitiveIds[0], prop: "y" },
            param2: { o_id: constraint.primitiveIds[1], prop: "y" },
            difference: constraint.value,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "angle": {
        // Angle between two lines
        if (
          constraint.primitiveIds.length === 2 &&
          constraint.value !== undefined
        ) {
          return {
            id: constraint.id,
            type: "l2l_angle_ll",
            l1_id: constraint.primitiveIds[0],
            l2_id: constraint.primitiveIds[1],
            angle: constraint.value,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "radius": {
        // Radius constraint on circle
        if (
          constraint.primitiveIds.length === 1 &&
          constraint.value !== undefined
        ) {
          return {
            id: constraint.id,
            type: "circle_radius",
            c_id: constraint.primitiveIds[0],
            radius: constraint.value,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "diameter": {
        // Convert diameter to radius
        if (
          constraint.primitiveIds.length === 1 &&
          constraint.value !== undefined
        ) {
          return {
            id: constraint.id,
            type: "circle_radius",
            c_id: constraint.primitiveIds[0],
            radius: constraint.value / 2,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "pointOnLine": {
        if (constraint.primitiveIds.length === 2) {
          // Automatically detect which is point/circle and which is line
          const prim0 = primitives.find(p => p.id === constraint.primitiveIds[0]);
          const prim1 = primitives.find(p => p.id === constraint.primitiveIds[1]);
          let pointId = constraint.primitiveIds[0];
          let lineId = constraint.primitiveIds[1];

          if (prim0 && prim1) {
            // Handle different primitive combinations
            if (prim0.type === "line" && (prim1.type === "point" || prim1.type === "circle")) {
              // Swap - line is first, point/circle is second
              lineId = constraint.primitiveIds[0];
              if (prim1.type === "circle") {
                // Use circle's center point
                pointId = (prim1 as any).centerId;
              } else {
                pointId = constraint.primitiveIds[1];
              }
            } else if (prim0.type === "circle") {
              // Use circle's center point
              pointId = (prim0 as any).centerId;
            }
          }

          return {
            id: constraint.id,
            type: "point_on_line_pl",
            p_id: pointId,
            l_id: lineId,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "pointOnCircle": {
        if (constraint.primitiveIds.length === 2) {
          // Automatically detect which is point and which is circle
          const prim0 = primitives.find(p => p.id === constraint.primitiveIds[0]);
          const prim1 = primitives.find(p => p.id === constraint.primitiveIds[1]);
          let pointId = constraint.primitiveIds[0];
          let circleId = constraint.primitiveIds[1];

          // Swap if first is circle and second is point
          if (prim0 && prim1) {
            if (prim1.type === "point" && prim0.type === "circle") {
              pointId = constraint.primitiveIds[1];
              circleId = constraint.primitiveIds[0];
            }
          }

          return {
            id: constraint.id,
            type: "point_on_circle",
            p_id: pointId,
            c_id: circleId,
            driving,
          } as GcsSketchPrimitive;
        }
        break;
      }

      case "midpoint": {
        // Point at midpoint of line
        // Midpoint constraint is complex - for now just log a warning
        // TODO: Implement using symmetric_ppl constraint when proper types are available
        console.warn("Midpoint constraint not yet fully implemented");
        break;
      }

      case "concentric": {
        // Two circles share the same center
        if (constraint.primitiveIds.length === 2) {
          const p1 = primitives.find((p) => p.id === constraint.primitiveIds[0]);
          const p2 = primitives.find((p) => p.id === constraint.primitiveIds[1]);

          if (p1 && p2 && isSketchCircle(p1) && isSketchCircle(p2)) {
            return {
              id: constraint.id,
              type: "p2p_coincident",
              p1_id: p1.centerId,
              p2_id: p2.centerId,
              driving,
            } as GcsSketchPrimitive;
          }
        }
        break;
      }
    }

    console.warn(`Unsupported constraint type: ${constraint.type}`);
    return null;
  }

  private applyGcsSolution(sketch: Sketch, gcs: GcsWrapper): Sketch {
    const updatedPrimitives: SketchPrimitive[] = [];

    for (const primitive of sketch.primitives) {
      if (isSketchPoint(primitive)) {
        const gcsPrimitive = gcs.sketch_index.get_primitive(primitive.id);
        if (gcsPrimitive && gcsPrimitive.type === "point") {
          const gcsPoint = gcsPrimitive as GcsSketchPoint;
          updatedPrimitives.push({
            ...primitive,
            x: gcsPoint.x,
            y: gcsPoint.y,
          });
        } else {
          updatedPrimitives.push(primitive);
        }
      } else if (isSketchCircle(primitive)) {
        const gcsPrimitive = gcs.sketch_index.get_primitive(primitive.id);
        if (gcsPrimitive && gcsPrimitive.type === "circle") {
          const gcsCircle = gcsPrimitive as GcsSketchCircle;
          updatedPrimitives.push({
            ...primitive,
            radius: gcsCircle.radius,
          });
        } else {
          updatedPrimitives.push(primitive);
        }
      } else if (isSketchArc(primitive)) {
        const gcsPrimitive = gcs.sketch_index.get_primitive(primitive.id);
        if (gcsPrimitive && gcsPrimitive.type === "arc") {
          const gcsArc = gcsPrimitive as GcsSketchArc;
          updatedPrimitives.push({
            ...primitive,
            radius: gcsArc.radius,
          });
        } else {
          updatedPrimitives.push(primitive);
        }
      } else {
        updatedPrimitives.push(primitive);
      }
    }

    return {
      ...sketch,
      primitives: updatedPrimitives,
    };
  }
}
