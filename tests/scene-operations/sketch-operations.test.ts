import * as THREE from "three";
import {
  createSketch,
  addPrimitiveToSketch,
  addConstraintToSketch,
  removePrimitiveFromSketch,
  removeConstraintFromSketch,
  updatePrimitiveInSketch,
  updateConstraintInSketch,
  getPointById,
  getAllPoints,
  getConstraintsForPrimitive,
} from "../../src/scene-operations/sketch-operations";
import {
  createSketchPlane,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchConstraint,
  Sketch,
} from "../../src/types/sketch-types";

describe("sketch-operations", () => {
  describe("createSketch", () => {
    it("should create sketch with XY plane", () => {
      const plane = createSketchPlane("XY");
      const result = createSketch(plane, 0);

      expect(result.sketch.id).toBe("sketch_0");
      expect(result.sketch.plane.type).toBe("XY");
      expect(result.sketch.plane.normal.z).toBe(1);
      expect(result.nextId).toBe(1);
    });

    it("should create sketch with XZ plane", () => {
      const plane = createSketchPlane("XZ");
      const result = createSketch(plane, 5);

      expect(result.sketch.id).toBe("sketch_5");
      expect(result.sketch.plane.type).toBe("XZ");
      expect(result.sketch.plane.normal.y).toBe(1);
      expect(result.nextId).toBe(6);
    });

    it("should create sketch with YZ plane", () => {
      const plane = createSketchPlane("YZ");
      const result = createSketch(plane, 10);

      expect(result.sketch.id).toBe("sketch_10");
      expect(result.sketch.plane.type).toBe("YZ");
      expect(result.sketch.plane.normal.x).toBe(1);
      expect(result.nextId).toBe(11);
    });

    it("should generate unique sketch ID", () => {
      const plane = createSketchPlane("XY");
      const result1 = createSketch(plane, 0);
      const result2 = createSketch(plane, result1.nextId);

      expect(result1.sketch.id).not.toBe(result2.sketch.id);
    });

    it("should initialize empty primitives array", () => {
      const plane = createSketchPlane("XY");
      const result = createSketch(plane, 0);

      expect(result.sketch.primitives).toEqual([]);
    });

    it("should initialize empty constraints array", () => {
      const plane = createSketchPlane("XY");
      const result = createSketch(plane, 0);

      expect(result.sketch.constraints).toEqual([]);
    });

    it("should set status to underconstrained", () => {
      const plane = createSketchPlane("XY");
      const result = createSketch(plane, 0);

      expect(result.sketch.status).toBe("underconstrained");
    });

    it("should initialize DOF to 0", () => {
      const plane = createSketchPlane("XY");
      const result = createSketch(plane, 0);

      expect(result.sketch.dof).toBe(0);
    });
  });

  describe("addPrimitiveToSketch", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;
    });

    describe("Points", () => {
      it("should add point primitive", () => {
        const point: SketchPoint = { id: "", type: "point", x: 1, y: 2 };
        const result = addPrimitiveToSketch(sketch, point, 1);

        expect(result.sketch.primitives).toHaveLength(1);
        expect(result.sketch.primitives[0].type).toBe("point");
      });

      it("should generate unique primitive ID", () => {
        const point: SketchPoint = { id: "", type: "point", x: 1, y: 2 };
        const result = addPrimitiveToSketch(sketch, point, 5);

        expect(result.sketch.primitives[0].id).toBe("prim_5");
        expect(result.nextId).toBe(6);
      });

      it("should preserve existing primitives", () => {
        const point1: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
        const point2: SketchPoint = { id: "", type: "point", x: 1, y: 1 };

        const result1 = addPrimitiveToSketch(sketch, point1, 1);
        const result2 = addPrimitiveToSketch(result1.sketch, point2, result1.nextId);

        expect(result2.sketch.primitives).toHaveLength(2);
        expect(result2.sketch.primitives[0].id).toBe("p1");
      });

      it("should use provided ID if given", () => {
        const point: SketchPoint = { id: "custom_id", type: "point", x: 1, y: 2 };
        const result = addPrimitiveToSketch(sketch, point, 5);

        expect(result.sketch.primitives[0].id).toBe("custom_id");
        expect(result.nextId).toBe(5); // ID not incremented when provided
      });

      it("should increase DOF by 2 for each point", () => {
        const point: SketchPoint = { id: "", type: "point", x: 1, y: 2 };
        const result = addPrimitiveToSketch(sketch, point, 1);

        expect(result.sketch.dof).toBe(2);
      });
    });

    describe("Lines", () => {
      it("should add line with valid point references", () => {
        // First add two points
        const p1: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
        const p2: SketchPoint = { id: "p2", type: "point", x: 1, y: 1 };
        let result = addPrimitiveToSketch(sketch, p1, 1);
        result = addPrimitiveToSketch(result.sketch, p2, result.nextId);

        // Then add line
        const line: SketchLine = { id: "", type: "line", p1Id: "p1", p2Id: "p2" };
        result = addPrimitiveToSketch(result.sketch, line, result.nextId);

        expect(result.sketch.primitives).toHaveLength(3);
        const addedLine = result.sketch.primitives[2] as SketchLine;
        expect(addedLine.type).toBe("line");
        expect(addedLine.p1Id).toBe("p1");
        expect(addedLine.p2Id).toBe("p2");
      });

      it("should add line even with invalid p1Id (no validation in function)", () => {
        // The function doesn't validate references - it just adds the primitive
        const line: SketchLine = { id: "", type: "line", p1Id: "invalid", p2Id: "p2" };
        const result = addPrimitiveToSketch(sketch, line, 1);

        expect(result.sketch.primitives).toHaveLength(1);
      });

      it("should not increase DOF for lines (only points increase DOF)", () => {
        const line: SketchLine = { id: "", type: "line", p1Id: "p1", p2Id: "p2" };
        const result = addPrimitiveToSketch(sketch, line, 1);

        expect(result.sketch.dof).toBe(0);
      });
    });

    describe("Circles", () => {
      it("should add circle with valid center reference", () => {
        const center: SketchPoint = { id: "center", type: "point", x: 0, y: 0 };
        let result = addPrimitiveToSketch(sketch, center, 1);

        const circle: SketchCircle = { id: "", type: "circle", centerId: "center", radius: 5 };
        result = addPrimitiveToSketch(result.sketch, circle, result.nextId);

        expect(result.sketch.primitives).toHaveLength(2);
        const addedCircle = result.sketch.primitives[1] as SketchCircle;
        expect(addedCircle.type).toBe("circle");
        expect(addedCircle.centerId).toBe("center");
      });

      it("should add circle with specified radius", () => {
        const circle: SketchCircle = { id: "", type: "circle", centerId: "c", radius: 10 };
        const result = addPrimitiveToSketch(sketch, circle, 1);

        const addedCircle = result.sketch.primitives[0] as SketchCircle;
        expect(addedCircle.radius).toBe(10);
      });
    });

    describe("Arcs", () => {
      it("should add arc with valid point references", () => {
        const center: SketchPoint = { id: "c", type: "point", x: 0, y: 0 };
        const start: SketchPoint = { id: "s", type: "point", x: 5, y: 0 };
        const end: SketchPoint = { id: "e", type: "point", x: 0, y: 5 };

        let result = addPrimitiveToSketch(sketch, center, 1);
        result = addPrimitiveToSketch(result.sketch, start, result.nextId);
        result = addPrimitiveToSketch(result.sketch, end, result.nextId);

        const arc: SketchArc = {
          id: "",
          type: "arc",
          centerId: "c",
          startId: "s",
          endId: "e",
          radius: 5,
        };
        result = addPrimitiveToSketch(result.sketch, arc, result.nextId);

        expect(result.sketch.primitives).toHaveLength(4);
        const addedArc = result.sketch.primitives[3] as SketchArc;
        expect(addedArc.type).toBe("arc");
        expect(addedArc.centerId).toBe("c");
        expect(addedArc.startId).toBe("s");
        expect(addedArc.endId).toBe("e");
        expect(addedArc.radius).toBe(5);
      });
    });

    describe("General", () => {
      it("should return updated sketch state", () => {
        const point: SketchPoint = { id: "", type: "point", x: 1, y: 2 };
        const result = addPrimitiveToSketch(sketch, point, 1);

        expect(result.sketch).not.toBe(sketch); // Immutable update
        expect(result.sketch.primitives).not.toBe(sketch.primitives);
      });
    });
  });

  describe("addConstraintToSketch", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;

      // Add some primitives for testing
      const p1: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
      const p2: SketchPoint = { id: "p2", type: "point", x: 1, y: 0 };
      let result = addPrimitiveToSketch(sketch, p1, 1);
      result = addPrimitiveToSketch(result.sketch, p2, result.nextId);

      const line: SketchLine = { id: "line1", type: "line", p1Id: "p1", p2Id: "p2" };
      result = addPrimitiveToSketch(result.sketch, line, result.nextId);
      sketch = result.sketch;
    });

    it("should add geometric constraint (horizontal)", () => {
      const constraint: SketchConstraint = {
        id: "",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.constraints).toHaveLength(1);
      expect(result.sketch.constraints[0].type).toBe("horizontal");
    });

    it("should add geometric constraint (vertical)", () => {
      const constraint: SketchConstraint = {
        id: "",
        type: "vertical",
        primitiveIds: ["line1"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.constraints).toHaveLength(1);
      expect(result.sketch.constraints[0].type).toBe("vertical");
    });

    it("should add dimensional constraint with value (distance)", () => {
      const constraint: SketchConstraint = {
        id: "",
        type: "distance",
        primitiveIds: ["p1", "p2"],
        value: 5,
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.constraints).toHaveLength(1);
      expect(result.sketch.constraints[0].type).toBe("distance");
      expect(result.sketch.constraints[0].value).toBe(5);
    });

    it("should generate unique constraint ID", () => {
      const constraint: SketchConstraint = {
        id: "",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.constraints[0].id).toBe("const_10");
      expect(result.nextId).toBe(11);
    });

    it("should use provided ID if given", () => {
      const constraint: SketchConstraint = {
        id: "my_constraint",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.constraints[0].id).toBe("my_constraint");
      expect(result.nextId).toBe(10); // Not incremented
    });

    it("should warn but not reject constraint with invalid primitive IDs", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const constraint: SketchConstraint = {
        id: "",
        type: "horizontal",
        primitiveIds: ["nonexistent"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("non-existent primitive")
      );
      expect(result.sketch.constraints).toHaveLength(1); // Still added

      consoleSpy.mockRestore();
    });

    it("should update sketch status after constraint", () => {
      const constraint: SketchConstraint = {
        id: "",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.status).toBe("underconstrained");
    });

    it("should decrease DOF after adding constraint", () => {
      // Set initial DOF
      sketch.dof = 4;
      const constraint: SketchConstraint = {
        id: "",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.dof).toBe(3); // Decreased by 1
    });

    it("should not allow DOF to go below 0", () => {
      sketch.dof = 0;
      const constraint: SketchConstraint = {
        id: "",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const result = addConstraintToSketch(sketch, constraint, 10);

      expect(result.sketch.dof).toBe(0);
    });
  });

  describe("removePrimitiveFromSketch", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;

      // Create a sketch with points, a line, and a constraint
      const p1: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
      const p2: SketchPoint = { id: "p2", type: "point", x: 1, y: 0 };
      const p3: SketchPoint = { id: "p3", type: "point", x: 2, y: 0 };
      let result = addPrimitiveToSketch(sketch, p1, 1);
      result = addPrimitiveToSketch(result.sketch, p2, result.nextId);
      result = addPrimitiveToSketch(result.sketch, p3, result.nextId);

      const line: SketchLine = { id: "line1", type: "line", p1Id: "p1", p2Id: "p2" };
      result = addPrimitiveToSketch(result.sketch, line, result.nextId);

      const constraint: SketchConstraint = {
        id: "c1",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const constResult = addConstraintToSketch(result.sketch, constraint, result.nextId);
      sketch = constResult.sketch;
    });

    it("should remove primitive by ID", () => {
      const result = removePrimitiveFromSketch(sketch, "p3");

      expect(result.sketch.primitives).toHaveLength(3); // Was 4, now 3
      expect(result.sketch.primitives.find((p) => p.id === "p3")).toBeUndefined();
    });

    it("should remove dependent constraints (lines referencing removed point)", () => {
      // Removing p1 should also remove line1 (which uses p1) and constraint c1 (which uses line1)
      const result = removePrimitiveFromSketch(sketch, "p1");

      expect(result.sketch.primitives.find((p) => p.id === "p1")).toBeUndefined();
      expect(result.sketch.primitives.find((p) => p.id === "line1")).toBeUndefined();
      expect(result.sketch.constraints).toHaveLength(0); // c1 removed because line1 removed
    });

    it("should handle non-existent primitive ID", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const result = removePrimitiveFromSketch(sketch, "nonexistent");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(result.sketch).toBe(sketch); // Unchanged

      consoleSpy.mockRestore();
    });

    it("should cascade removal for connected primitives", () => {
      // Add a circle that depends on p1
      const circle: SketchCircle = { id: "circle1", type: "circle", centerId: "p1", radius: 5 };
      let result = addPrimitiveToSketch(sketch, circle, 100);
      sketch = result.sketch;

      // Removing p1 should also remove the circle
      const removeResult = removePrimitiveFromSketch(sketch, "p1");

      expect(removeResult.sketch.primitives.find((p) => p.id === "circle1")).toBeUndefined();
    });

    it("should update sketch status after removal", () => {
      const result = removePrimitiveFromSketch(sketch, "p3");

      expect(result.sketch.status).toBe("underconstrained");
    });
  });

  describe("removeConstraintFromSketch", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;

      const p1: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
      const p2: SketchPoint = { id: "p2", type: "point", x: 1, y: 0 };
      let result = addPrimitiveToSketch(sketch, p1, 1);
      result = addPrimitiveToSketch(result.sketch, p2, result.nextId);

      const line: SketchLine = { id: "line1", type: "line", p1Id: "p1", p2Id: "p2" };
      result = addPrimitiveToSketch(result.sketch, line, result.nextId);

      const constraint: SketchConstraint = {
        id: "c1",
        type: "horizontal",
        primitiveIds: ["line1"],
      };
      const constResult = addConstraintToSketch(result.sketch, constraint, result.nextId);
      sketch = constResult.sketch;
      sketch.dof = 2; // Set initial DOF
    });

    it("should remove constraint by ID", () => {
      const result = removeConstraintFromSketch(sketch, "c1");

      expect(result.sketch.constraints).toHaveLength(0);
    });

    it("should increase DOF after removal", () => {
      const result = removeConstraintFromSketch(sketch, "c1");

      expect(result.sketch.dof).toBe(3); // Was 2, now 3
    });

    it("should handle non-existent constraint ID", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const result = removeConstraintFromSketch(sketch, "nonexistent");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(result.sketch).toBe(sketch); // Unchanged

      consoleSpy.mockRestore();
    });

    it("should not affect primitives when removing constraint", () => {
      const primitiveCount = sketch.primitives.length;
      const result = removeConstraintFromSketch(sketch, "c1");

      expect(result.sketch.primitives).toHaveLength(primitiveCount);
    });
  });

  describe("updatePrimitiveInSketch", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;

      const point: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
      const result = addPrimitiveToSketch(sketch, point, 1);
      sketch = result.sketch;
    });

    it("should update primitive position", () => {
      const updated = updatePrimitiveInSketch(sketch, "p1", { x: 10, y: 20 });

      const point = updated.primitives[0] as SketchPoint;
      expect(point.x).toBe(10);
      expect(point.y).toBe(20);
    });

    it("should not modify other primitives", () => {
      const p2: SketchPoint = { id: "p2", type: "point", x: 5, y: 5 };
      let result = addPrimitiveToSketch(sketch, p2, 2);
      sketch = result.sketch;

      const updated = updatePrimitiveInSketch(sketch, "p1", { x: 10, y: 20 });

      const point2 = updated.primitives[1] as SketchPoint;
      expect(point2.x).toBe(5);
      expect(point2.y).toBe(5);
    });

    it("should return immutable updated sketch", () => {
      const updated = updatePrimitiveInSketch(sketch, "p1", { x: 10 });

      expect(updated).not.toBe(sketch);
      expect(updated.primitives).not.toBe(sketch.primitives);
    });
  });

  describe("updateConstraintInSketch", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;

      const constraint: SketchConstraint = {
        id: "c1",
        type: "distance",
        primitiveIds: ["p1", "p2"],
        value: 5,
      };
      const result = addConstraintToSketch(sketch, constraint, 1);
      sketch = result.sketch;
    });

    it("should update constraint value", () => {
      const updated = updateConstraintInSketch(sketch, "c1", { value: 10 });

      expect(updated.constraints[0].value).toBe(10);
    });

    it("should not modify other constraints", () => {
      const c2: SketchConstraint = {
        id: "c2",
        type: "distance",
        primitiveIds: ["p2", "p3"],
        value: 3,
      };
      const result = addConstraintToSketch(sketch, c2, 2);
      sketch = result.sketch;

      const updated = updateConstraintInSketch(sketch, "c1", { value: 10 });

      expect(updated.constraints[1].value).toBe(3);
    });
  });

  describe("getPointById", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;

      const p1: SketchPoint = { id: "p1", type: "point", x: 1, y: 2 };
      const line: SketchLine = { id: "line1", type: "line", p1Id: "p1", p2Id: "p2" };
      let result = addPrimitiveToSketch(sketch, p1, 1);
      result = addPrimitiveToSketch(result.sketch, line, result.nextId);
      sketch = result.sketch;
    });

    it("should return point by ID", () => {
      const point = getPointById(sketch, "p1");

      expect(point).toBeDefined();
      expect(point?.x).toBe(1);
      expect(point?.y).toBe(2);
    });

    it("should return undefined for non-existent ID", () => {
      const point = getPointById(sketch, "nonexistent");

      expect(point).toBeUndefined();
    });

    it("should return undefined for non-point primitive", () => {
      const point = getPointById(sketch, "line1");

      expect(point).toBeUndefined();
    });
  });

  describe("getAllPoints", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;
    });

    it("should return all points", () => {
      const p1: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
      const p2: SketchPoint = { id: "p2", type: "point", x: 1, y: 1 };
      const line: SketchLine = { id: "line1", type: "line", p1Id: "p1", p2Id: "p2" };

      let result = addPrimitiveToSketch(sketch, p1, 1);
      result = addPrimitiveToSketch(result.sketch, p2, result.nextId);
      result = addPrimitiveToSketch(result.sketch, line, result.nextId);
      sketch = result.sketch;

      const points = getAllPoints(sketch);

      expect(points).toHaveLength(2);
      expect(points.every((p) => p.type === "point")).toBe(true);
    });

    it("should return empty array for sketch with no points", () => {
      const line: SketchLine = { id: "line1", type: "line", p1Id: "p1", p2Id: "p2" };
      const result = addPrimitiveToSketch(sketch, line, 1);
      sketch = result.sketch;

      const points = getAllPoints(sketch);

      expect(points).toHaveLength(0);
    });
  });

  describe("getConstraintsForPrimitive", () => {
    let sketch: Sketch;

    beforeEach(() => {
      const plane = createSketchPlane("XY");
      sketch = createSketch(plane, 0).sketch;

      const p1: SketchPoint = { id: "p1", type: "point", x: 0, y: 0 };
      const p2: SketchPoint = { id: "p2", type: "point", x: 1, y: 0 };
      let result = addPrimitiveToSketch(sketch, p1, 1);
      result = addPrimitiveToSketch(result.sketch, p2, result.nextId);

      const line: SketchLine = { id: "line1", type: "line", p1Id: "p1", p2Id: "p2" };
      result = addPrimitiveToSketch(result.sketch, line, result.nextId);

      const c1: SketchConstraint = { id: "c1", type: "horizontal", primitiveIds: ["line1"] };
      const c2: SketchConstraint = { id: "c2", type: "distance", primitiveIds: ["p1", "p2"], value: 5 };
      let constResult = addConstraintToSketch(result.sketch, c1, result.nextId);
      constResult = addConstraintToSketch(constResult.sketch, c2, constResult.nextId);
      sketch = constResult.sketch;
    });

    it("should return all constraints for a primitive", () => {
      const constraints = getConstraintsForPrimitive(sketch, "p1");

      expect(constraints).toHaveLength(1); // Only c2 references p1
      expect(constraints[0].id).toBe("c2");
    });

    it("should return empty array for primitive with no constraints", () => {
      const p3: SketchPoint = { id: "p3", type: "point", x: 5, y: 5 };
      const result = addPrimitiveToSketch(sketch, p3, 100);
      sketch = result.sketch;

      const constraints = getConstraintsForPrimitive(sketch, "p3");

      expect(constraints).toHaveLength(0);
    });

    it("should return multiple constraints if primitive is referenced by multiple", () => {
      // Add another constraint referencing line1
      const c3: SketchConstraint = { id: "c3", type: "vertical", primitiveIds: ["line1"] };
      const result = addConstraintToSketch(sketch, c3, 100);
      sketch = result.sketch;

      const constraints = getConstraintsForPrimitive(sketch, "line1");

      expect(constraints).toHaveLength(2); // c1 and c3
    });
  });
});
