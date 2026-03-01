import {
  Sketch,
  SketchPlane,
  SketchPrimitive,
  SketchConstraint,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  isSketchPoint,
  isSketchLine,
  isSketchCircle,
  isSketchArc,
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

// ── Trim/Split helpers ──

export interface SplitLineResult {
  sketch: Sketch;
  newPointIds: string[];
  newLineIds: string[];
  nextId: number;
}

/**
 * Split a line at given t-parameter points, creating new points and line segments.
 * Removes the original line. Transfers geometric constraints to the surviving
 * segment(s) where applicable. Drops dimensional constraints (length changed).
 */
export function splitLineAtParams(
  sketch: Sketch,
  lineId: string,
  splitParams: number[],
  idCounter: number,
): SplitLineResult {
  const line = sketch.primitives.find(p => p.id === lineId && isSketchLine(p)) as SketchLine | undefined;
  if (!line) return { sketch, newPointIds: [], newLineIds: [], nextId: idCounter };

  const p1 = sketch.primitives.find(p => p.id === line.p1Id && isSketchPoint(p)) as SketchPoint | undefined;
  const p2 = sketch.primitives.find(p => p.id === line.p2Id && isSketchPoint(p)) as SketchPoint | undefined;
  if (!p1 || !p2) return { sketch, newPointIds: [], newLineIds: [], nextId: idCounter };

  // Sort t-params and filter duplicates near 0 or 1
  const sorted = [...new Set(splitParams)]
    .filter(t => t > 1e-4 && t < 1 - 1e-4)
    .sort((a, b) => a - b);

  if (sorted.length === 0) return { sketch, newPointIds: [], newLineIds: [], nextId: idCounter };

  let nextId = idCounter;
  const newPoints: SketchPoint[] = [];
  const newLines: SketchLine[] = [];

  // Create new intersection points
  for (const t of sorted) {
    nextId++;
    const pt: SketchPoint = {
      id: `point_${nextId}`,
      type: "point",
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    };
    newPoints.push(pt);
  }

  // Create line segments: p1→split1, split1→split2, ..., splitN→p2
  const orderedPointIds = [line.p1Id, ...newPoints.map(p => p.id), line.p2Id];
  for (let i = 0; i < orderedPointIds.length - 1; i++) {
    nextId++;
    newLines.push({
      id: `line_${nextId}`,
      type: "line",
      p1Id: orderedPointIds[i],
      p2Id: orderedPointIds[i + 1],
      construction: line.construction,
    });
  }

  // Remove original line, add new points and lines
  let updatedPrimitives = sketch.primitives.filter(p => p.id !== lineId);
  updatedPrimitives = [...updatedPrimitives, ...newPoints, ...newLines];

  // Transfer constraints: keep coincident constraints at original endpoints,
  // geometric constraints (H/V/parallel/perp) go to first surviving segment,
  // drop dimensional constraints (geometry length changed)
  const updatedConstraints = sketch.constraints.map(c => {
    if (!c.primitiveIds.includes(lineId)) return c;

    // Geometric constraints: remap to first new line segment
    if (["horizontal", "vertical", "parallel", "perpendicular", "equal"].includes(c.type)) {
      return {
        ...c,
        primitiveIds: c.primitiveIds.map(id => id === lineId ? newLines[0].id : id),
      };
    }

    // Coincident at original endpoints: keep with segment that has that endpoint
    if (c.type === "coincident") {
      return c; // Coincident references point IDs, not line IDs — unchanged
    }

    // Dimensional: drop (length has changed)
    if (["distance", "distanceX", "distanceY"].includes(c.type)) {
      return null;
    }

    return c;
  }).filter((c): c is SketchConstraint => c !== null);

  return {
    sketch: {
      ...sketch,
      primitives: updatedPrimitives,
      constraints: updatedConstraints,
      status: "underconstrained",
    },
    newPointIds: newPoints.map(p => p.id),
    newLineIds: newLines.map(l => l.id),
    nextId,
  };
}

/**
 * Remove a specific line segment from a split result.
 * Removes the line and its exclusive points (points not used by other primitives).
 */
export function removeLineSegment(
  sketch: Sketch,
  lineId: string,
): Sketch {
  const line = sketch.primitives.find(p => p.id === lineId && isSketchLine(p)) as SketchLine | undefined;
  if (!line) return sketch;

  // Check which points are used only by this line
  const pointIdsToCheck = [line.p1Id, line.p2Id];
  const exclusivePointIds = pointIdsToCheck.filter(ptId => {
    const usedBy = sketch.primitives.filter(p => {
      if (p.id === lineId) return false;
      if (isSketchLine(p)) return p.p1Id === ptId || p.p2Id === ptId;
      if (isSketchCircle(p)) return p.centerId === ptId;
      if (isSketchArc(p)) return p.centerId === ptId || p.startId === ptId || p.endId === ptId;
      return false;
    });
    return usedBy.length === 0;
  });

  const removeIds = new Set([lineId, ...exclusivePointIds]);
  const updatedPrimitives = sketch.primitives.filter(p => !removeIds.has(p.id));
  const updatedConstraints = sketch.constraints.filter(
    c => !c.primitiveIds.some(id => removeIds.has(id)),
  );

  return {
    ...sketch,
    primitives: updatedPrimitives,
    constraints: updatedConstraints,
    status: "underconstrained",
  };
}

/**
 * Trim a line at intersection points, removing the segment under the cursor.
 * - If cursor is on an end segment: shorten the line (update endpoint position)
 * - If cursor is on a middle segment: split line, remove middle segment
 */
export function trimLineAtSegment(
  sketch: Sketch,
  lineId: string,
  startParam: number,
  endParam: number,
  intersectionParams: number[],
  idCounter: number,
): { sketch: Sketch; nextId: number } {
  const line = sketch.primitives.find(p => p.id === lineId && isSketchLine(p)) as SketchLine | undefined;
  if (!line) return { sketch, nextId: idCounter };

  const p1 = sketch.primitives.find(p => p.id === line.p1Id && isSketchPoint(p)) as SketchPoint | undefined;
  const p2 = sketch.primitives.find(p => p.id === line.p2Id && isSketchPoint(p)) as SketchPoint | undefined;
  if (!p1 || !p2) return { sketch, nextId: idCounter };

  const isStartSegment = startParam < 1e-4;
  const isEndSegment = endParam > 1 - 1e-4;

  if (isStartSegment && isEndSegment) {
    // Only segment (no intersections) — remove entire line
    return {
      sketch: removeLineSegment(sketch, lineId),
      nextId: idCounter,
    };
  }

  if (isStartSegment) {
    // Trim from start: move p1 to endParam position
    const newX = p1.x + endParam * (p2.x - p1.x);
    const newY = p1.y + endParam * (p2.y - p1.y);
    const updatedSketch = updatePrimitiveInSketch(sketch, line.p1Id, { x: newX, y: newY });
    // Drop dimensional constraints on the line
    const filteredConstraints = updatedSketch.constraints.filter(c => {
      if (!c.primitiveIds.includes(lineId)) return true;
      return !["distance", "distanceX", "distanceY"].includes(c.type);
    });
    return {
      sketch: { ...updatedSketch, constraints: filteredConstraints, status: "underconstrained" },
      nextId: idCounter,
    };
  }

  if (isEndSegment) {
    // Trim from end: move p2 to startParam position
    const newX = p1.x + startParam * (p2.x - p1.x);
    const newY = p1.y + startParam * (p2.y - p1.y);
    const updatedSketch = updatePrimitiveInSketch(sketch, line.p2Id, { x: newX, y: newY });
    const filteredConstraints = updatedSketch.constraints.filter(c => {
      if (!c.primitiveIds.includes(lineId)) return true;
      return !["distance", "distanceX", "distanceY"].includes(c.type);
    });
    return {
      sketch: { ...updatedSketch, constraints: filteredConstraints, status: "underconstrained" },
      nextId: idCounter,
    };
  }

  // Middle segment: split line then remove the middle segment
  const splitResult = splitLineAtParams(sketch, lineId, intersectionParams, idCounter);

  // Find which new line segment covers [startParam, endParam]
  // After split, segments are in order: line0 covers [0, sorted[0]], line1 covers [sorted[0], sorted[1]], etc.
  const sortedParams = [...intersectionParams].filter(t => t > 1e-4 && t < 1 - 1e-4).sort((a, b) => a - b);
  let segmentIndex = -1;
  const boundaries = [0, ...sortedParams, 1];
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (Math.abs(boundaries[i] - startParam) < 1e-3 && Math.abs(boundaries[i + 1] - endParam) < 1e-3) {
      segmentIndex = i;
      break;
    }
  }

  if (segmentIndex >= 0 && segmentIndex < splitResult.newLineIds.length) {
    const lineToRemove = splitResult.newLineIds[segmentIndex];
    return {
      sketch: removeLineSegment(splitResult.sketch, lineToRemove),
      nextId: splitResult.nextId,
    };
  }

  return { sketch: splitResult.sketch, nextId: splitResult.nextId };
}

/**
 * Convert a circle to an arc by removing a segment.
 * The segment to remove is defined by startAngle→endAngle.
 * The surviving arc spans from endAngle→startAngle (the complement).
 */
export function convertCircleToArc(
  sketch: Sketch,
  circleId: string,
  removeStartAngle: number,
  removeEndAngle: number,
  idCounter: number,
): { sketch: Sketch; arcId: string; nextId: number } {
  const circle = sketch.primitives.find(
    p => p.id === circleId && isSketchCircle(p),
  ) as SketchCircle | undefined;
  if (!circle) return { sketch, arcId: "", nextId: idCounter };

  const center = sketch.primitives.find(
    p => p.id === circle.centerId && isSketchPoint(p),
  ) as SketchPoint | undefined;
  if (!center) return { sketch, arcId: "", nextId: idCounter };

  let nextId = idCounter;

  // Create start and end points on the circle boundary
  // The surviving arc goes from removeEndAngle to removeStartAngle
  nextId++;
  const startPt: SketchPoint = {
    id: `point_${nextId}`,
    type: "point",
    x: center.x + circle.radius * Math.cos(removeEndAngle),
    y: center.y + circle.radius * Math.sin(removeEndAngle),
  };

  nextId++;
  const endPt: SketchPoint = {
    id: `point_${nextId}`,
    type: "point",
    x: center.x + circle.radius * Math.cos(removeStartAngle),
    y: center.y + circle.radius * Math.sin(removeStartAngle),
  };

  nextId++;
  const arc: SketchArc = {
    id: `arc_${nextId}`,
    type: "arc",
    centerId: circle.centerId,
    startId: startPt.id,
    endId: endPt.id,
    radius: circle.radius,
    construction: circle.construction,
  };

  // Replace circle with arc + new points
  let updatedPrimitives = sketch.primitives.filter(p => p.id !== circleId);
  updatedPrimitives = [...updatedPrimitives, startPt, endPt, arc];

  // Transfer constraints from circle to arc
  const updatedConstraints = sketch.constraints.map(c => {
    if (!c.primitiveIds.includes(circleId)) return c;

    // Radius/diameter constraints transfer
    if (c.type === "radius" || c.type === "diameter" || c.type === "concentric") {
      return { ...c, primitiveIds: c.primitiveIds.map(id => id === circleId ? arc.id : id) };
    }

    // pointOnCircle → keep (references point IDs, but circle ID changes)
    if (c.type === "pointOnCircle") {
      return { ...c, primitiveIds: c.primitiveIds.map(id => id === circleId ? arc.id : id) };
    }

    // Other constraints involving the circle: drop
    return null;
  }).filter((c): c is SketchConstraint => c !== null);

  return {
    sketch: {
      ...sketch,
      primitives: updatedPrimitives,
      constraints: updatedConstraints,
      status: "underconstrained",
    },
    arcId: arc.id,
    nextId,
  };
}
