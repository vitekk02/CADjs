import {
  Sketch,
  SketchPlane,
  SketchPrimitive,
  SketchConstraint,
  SketchPoint,
  isSketchPoint,
} from "../types/sketch-types";

export interface CreateSketchResult {
  sketch: Sketch;
  nextId: number;
}

export interface AddPrimitiveResult {
  sketch: Sketch;
  nextId: number;
}

export interface AddConstraintResult {
  sketch: Sketch;
  nextId: number;
}

export interface RemovePrimitiveResult {
  sketch: Sketch;
}

export interface RemoveConstraintResult {
  sketch: Sketch;
}

export function createSketch(
  plane: SketchPlane,
  idCounter: number,
): CreateSketchResult {
  const sketch: Sketch = {
    id: `sketch_${idCounter}`,
    plane,
    primitives: [],
    constraints: [],
    dof: 0,
    status: "underconstrained",
  };

  return {
    sketch,
    nextId: idCounter + 1,
  };
}

export function addPrimitiveToSketch(
  sketch: Sketch,
  primitive: SketchPrimitive,
  idCounter: number,
): AddPrimitiveResult {
  // Generate ID if not provided
  const primitiveWithId: SketchPrimitive = primitive.id
    ? primitive
    : { ...primitive, id: `prim_${idCounter}` };

  const updatedSketch: Sketch = {
    ...sketch,
    primitives: [...sketch.primitives, primitiveWithId],
    // DOF increases by 2 for each unconstrained point
    dof: sketch.dof + (isSketchPoint(primitiveWithId) ? 2 : 0),
    status: "underconstrained",
  };

  return {
    sketch: updatedSketch,
    nextId: primitive.id ? idCounter : idCounter + 1,
  };
}

export function addConstraintToSketch(
  sketch: Sketch,
  constraint: SketchConstraint,
  idCounter: number,
): AddConstraintResult {
  // Generate ID if not provided
  const constraintWithId: SketchConstraint = constraint.id
    ? constraint
    : { ...constraint, id: `const_${idCounter}` };

  // Verify all referenced primitives exist
  for (const primitiveId of constraintWithId.primitiveIds) {
    const exists = sketch.primitives.some((p) => p.id === primitiveId);
    if (!exists) {
      console.warn(
        `Constraint references non-existent primitive: ${primitiveId}`,
      );
    }
  }

  const updatedSketch: Sketch = {
    ...sketch,
    constraints: [...sketch.constraints, constraintWithId],
    // DOF decreases by constraint count (simplified - actual reduction depends on constraint type)
    dof: Math.max(0, sketch.dof - 1),
    status: "underconstrained",
  };

  return {
    sketch: updatedSketch,
    nextId: constraint.id ? idCounter : idCounter + 1,
  };
}

export function removePrimitiveFromSketch(
  sketch: Sketch,
  primitiveId: string,
): RemovePrimitiveResult {
  const primitiveToRemove = sketch.primitives.find((p) => p.id === primitiveId);

  if (!primitiveToRemove) {
    console.warn(`Primitive not found: ${primitiveId}`);
    return { sketch };
  }

  // Remove primitive
  const updatedPrimitives = sketch.primitives.filter(
    (p) => p.id !== primitiveId,
  );

  // Remove constraints that reference this primitive
  const updatedConstraints = sketch.constraints.filter(
    (c) => !c.primitiveIds.includes(primitiveId),
  );

  // Also remove primitives that depend on this one (e.g., lines that use this point)
  const dependentIds = new Set<string>();
  for (const p of sketch.primitives) {
    if (p.id === primitiveId) continue;

    if (p.type === "line") {
      if (p.p1Id === primitiveId || p.p2Id === primitiveId) {
        dependentIds.add(p.id);
      }
    } else if (p.type === "circle") {
      if (p.centerId === primitiveId) {
        dependentIds.add(p.id);
      }
    } else if (p.type === "arc") {
      if (
        p.centerId === primitiveId ||
        p.startId === primitiveId ||
        p.endId === primitiveId
      ) {
        dependentIds.add(p.id);
      }
    } else if (p.type === "ellipse") {
      if (p.centerId === primitiveId || p.focus1Id === primitiveId) {
        dependentIds.add(p.id);
      }
    }
  }

  const finalPrimitives = updatedPrimitives.filter(
    (p) => !dependentIds.has(p.id),
  );

  // Remove constraints that reference dependent primitives
  const finalConstraints = updatedConstraints.filter(
    (c) => !c.primitiveIds.some((id) => dependentIds.has(id)),
  );

  const updatedSketch: Sketch = {
    ...sketch,
    primitives: finalPrimitives,
    constraints: finalConstraints,
    status: "underconstrained",
  };

  return { sketch: updatedSketch };
}

export function removeConstraintFromSketch(
  sketch: Sketch,
  constraintId: string,
): RemoveConstraintResult {
  const constraintToRemove = sketch.constraints.find(
    (c) => c.id === constraintId,
  );

  if (!constraintToRemove) {
    console.warn(`Constraint not found: ${constraintId}`);
    return { sketch };
  }

  const updatedConstraints = sketch.constraints.filter(
    (c) => c.id !== constraintId,
  );

  const updatedSketch: Sketch = {
    ...sketch,
    constraints: updatedConstraints,
    // DOF increases when constraint is removed
    dof: sketch.dof + 1,
    status: "underconstrained",
  };

  return { sketch: updatedSketch };
}

export function updatePrimitiveInSketch(
  sketch: Sketch,
  primitiveId: string,
  updates: Partial<SketchPrimitive>,
): Sketch {
  const updatedPrimitives = sketch.primitives.map((p) => {
    if (p.id === primitiveId) {
      return { ...p, ...updates } as SketchPrimitive;
    }
    return p;
  });

  return {
    ...sketch,
    primitives: updatedPrimitives,
  };
}

export function updateConstraintInSketch(
  sketch: Sketch,
  constraintId: string,
  updates: Partial<SketchConstraint>,
): Sketch {
  const updatedConstraints = sketch.constraints.map((c) => {
    if (c.id === constraintId) {
      return { ...c, ...updates };
    }
    return c;
  });

  return {
    ...sketch,
    constraints: updatedConstraints,
  };
}

export function getPointById(
  sketch: Sketch,
  pointId: string,
): SketchPoint | undefined {
  const primitive = sketch.primitives.find((p) => p.id === pointId);
  if (primitive && isSketchPoint(primitive)) {
    return primitive;
  }
  return undefined;
}

export function getAllPoints(sketch: Sketch): SketchPoint[] {
  return sketch.primitives.filter(isSketchPoint);
}

export function getConstraintsForPrimitive(
  sketch: Sketch,
  primitiveId: string,
): SketchConstraint[] {
  return sketch.constraints.filter((c) =>
    c.primitiveIds.includes(primitiveId),
  );
}
