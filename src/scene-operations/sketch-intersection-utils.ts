import {
  Sketch,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchPrimitive,
  isSketchPoint,
  isSketchLine,
  isSketchCircle,
  isSketchArc,
} from "../types/sketch-types";

export interface IntersectionResult {
  point: { x: number; y: number };
  /** Parameter on the source primitive (0-1 for lines, angle for arcs/circles) */
  tSource: number;
  /** Parameter on the other primitive */
  tOther: number;
  otherPrimId: string;
}

// ── Low-level intersection functions ──

/**
 * Line-line intersection.
 * Lines defined by (p1→p2) and (p3→p4).
 * Returns null if parallel.
 */
export function lineLineIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): { point: { x: number; y: number }; t: number; u: number } | null {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x;
  const dy2 = p4.y - p3.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / denom;
  const u = ((p3.x - p1.x) * dy1 - (p3.y - p1.y) * dx1) / denom;

  return {
    point: { x: p1.x + t * dx1, y: p1.y + t * dy1 },
    t,
    u,
  };
}

/**
 * Line-circle intersection.
 * Line defined by (p1→p2), circle by center+radius.
 * Returns array of intersections with t-parameters on line and angles on circle.
 */
export function lineCircleIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  center: { x: number; y: number },
  radius: number,
): { point: { x: number; y: number }; t: number; angle: number }[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-10) return [];

  const results: { point: { x: number; y: number }; t: number; angle: number }[] = [];
  const sqrtD = Math.sqrt(Math.max(0, discriminant));

  for (const sign of [-1, 1]) {
    const t = (-b + sign * sqrtD) / (2 * a);
    const x = p1.x + t * dx;
    const y = p1.y + t * dy;
    const angle = Math.atan2(y - center.y, x - center.x);
    results.push({ point: { x, y }, t, angle });
  }

  // If discriminant is near zero, we have one tangent point — deduplicate
  if (discriminant < 1e-6 && results.length === 2) {
    return [results[0]];
  }

  return results;
}

/**
 * Circle-circle intersection.
 */
export function circleCircleIntersect(
  c1: { x: number; y: number },
  r1: number,
  c2: { x: number; y: number },
  r2: number,
): { point: { x: number; y: number }; angle1: number; angle2: number }[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d > r1 + r2 + 1e-10 || d < Math.abs(r1 - r2) - 1e-10 || d < 1e-10) {
    return [];
  }

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));

  const mx = c1.x + a * dx / d;
  const my = c1.y + a * dy / d;

  const results: { point: { x: number; y: number }; angle1: number; angle2: number }[] = [];

  for (const sign of [-1, 1]) {
    const x = mx + sign * h * dy / d;
    const y = my - sign * h * dx / d;
    results.push({
      point: { x, y },
      angle1: Math.atan2(y - c1.y, x - c1.x),
      angle2: Math.atan2(y - c2.y, x - c2.x),
    });
  }

  if (h < 1e-6 && results.length === 2) {
    return [results[0]];
  }

  return results;
}

// ── Helper: check if angle is within arc range ──

function normalizeAngle(a: number): number {
  while (a < 0) a += 2 * Math.PI;
  while (a >= 2 * Math.PI) a -= 2 * Math.PI;
  return a;
}

function isAngleInArcRange(angle: number, startAngle: number, endAngle: number): boolean {
  const a = normalizeAngle(angle);
  const s = normalizeAngle(startAngle);
  const e = normalizeAngle(endAngle);

  if (s <= e) {
    return a >= s - 1e-6 && a <= e + 1e-6;
  } else {
    // Arc wraps around 0/2π
    return a >= s - 1e-6 || a <= e + 1e-6;
  }
}

// ── Sketch-level intersection finder ──

function getPointById(sketch: Sketch, id: string): SketchPoint | null {
  const p = sketch.primitives.find(p => p.id === id && isSketchPoint(p));
  return p ? (p as SketchPoint) : null;
}

function getLineEndpoints(
  sketch: Sketch,
  line: SketchLine,
): { p1: { x: number; y: number }; p2: { x: number; y: number } } | null {
  const pt1 = getPointById(sketch, line.p1Id);
  const pt2 = getPointById(sketch, line.p2Id);
  if (!pt1 || !pt2) return null;
  return { p1: { x: pt1.x, y: pt1.y }, p2: { x: pt2.x, y: pt2.y } };
}

function getCircleCenter(sketch: Sketch, prim: SketchCircle | SketchArc): { x: number; y: number } | null {
  const center = getPointById(sketch, prim.centerId);
  return center ? { x: center.x, y: center.y } : null;
}

function getArcAngles(sketch: Sketch, arc: SketchArc): { startAngle: number; endAngle: number } | null {
  const center = getPointById(sketch, arc.centerId);
  const startPt = getPointById(sketch, arc.startId);
  const endPt = getPointById(sketch, arc.endId);
  if (!center || !startPt || !endPt) return null;
  return {
    startAngle: Math.atan2(startPt.y - center.y, startPt.x - center.x),
    endAngle: Math.atan2(endPt.y - center.y, endPt.x - center.x),
  };
}

/**
 * Find all intersections between a source primitive and all other primitives in the sketch.
 * Only returns intersections that lie ON both primitives (within their bounds).
 */
export function findAllIntersections(
  sketch: Sketch,
  sourcePrimId: string,
): IntersectionResult[] {
  const sourcePrim = sketch.primitives.find(p => p.id === sourcePrimId);
  if (!sourcePrim) return [];

  const results: IntersectionResult[] = [];

  for (const otherPrim of sketch.primitives) {
    if (otherPrim.id === sourcePrimId) continue;
    if (isSketchPoint(otherPrim)) continue;

    const intersections = findPrimitivePairIntersections(sketch, sourcePrim, otherPrim);
    for (const ix of intersections) {
      results.push({ ...ix, otherPrimId: otherPrim.id });
    }
  }

  return results;
}

function findPrimitivePairIntersections(
  sketch: Sketch,
  source: SketchPrimitive,
  other: SketchPrimitive,
): Omit<IntersectionResult, "otherPrimId">[] {
  if (isSketchLine(source) && isSketchLine(other)) {
    return intersectLineLine(sketch, source, other);
  }
  if (isSketchLine(source) && isSketchCircle(other)) {
    return intersectLineCircle(sketch, source, other);
  }
  if (isSketchLine(source) && isSketchArc(other)) {
    return intersectLineArc(sketch, source, other);
  }
  if (isSketchCircle(source) && isSketchLine(other)) {
    return intersectLineCircle(sketch, other, source).map(r => ({
      point: r.point,
      tSource: r.tOther,
      tOther: r.tSource,
    }));
  }
  if (isSketchCircle(source) && isSketchCircle(other)) {
    return intersectCircleCircle(sketch, source, other);
  }
  if (isSketchCircle(source) && isSketchArc(other)) {
    return intersectCircleArc(sketch, source, other);
  }
  if (isSketchArc(source) && isSketchLine(other)) {
    return intersectLineArc(sketch, other, source).map(r => ({
      point: r.point,
      tSource: r.tOther,
      tOther: r.tSource,
    }));
  }
  if (isSketchArc(source) && isSketchCircle(other)) {
    return intersectCircleArc(sketch, other, source).map(r => ({
      point: r.point,
      tSource: r.tOther,
      tOther: r.tSource,
    }));
  }
  if (isSketchArc(source) && isSketchArc(other)) {
    return intersectArcArc(sketch, source, other);
  }
  return [];
}

function intersectLineLine(
  sketch: Sketch,
  l1: SketchLine,
  l2: SketchLine,
): Omit<IntersectionResult, "otherPrimId">[] {
  const e1 = getLineEndpoints(sketch, l1);
  const e2 = getLineEndpoints(sketch, l2);
  if (!e1 || !e2) return [];

  const result = lineLineIntersect(e1.p1, e1.p2, e2.p1, e2.p2);
  if (!result) return [];

  // Both t and u must be within [0,1] (on both line segments)
  if (result.t < -1e-6 || result.t > 1 + 1e-6 || result.u < -1e-6 || result.u > 1 + 1e-6) {
    return [];
  }

  return [{ point: result.point, tSource: result.t, tOther: result.u }];
}

function intersectLineCircle(
  sketch: Sketch,
  line: SketchLine,
  circle: SketchCircle,
): Omit<IntersectionResult, "otherPrimId">[] {
  const ends = getLineEndpoints(sketch, line);
  const center = getCircleCenter(sketch, circle);
  if (!ends || !center) return [];

  const ixs = lineCircleIntersect(ends.p1, ends.p2, center, circle.radius);
  return ixs
    .filter(ix => ix.t >= -1e-6 && ix.t <= 1 + 1e-6)
    .map(ix => ({ point: ix.point, tSource: ix.t, tOther: ix.angle }));
}

function intersectLineArc(
  sketch: Sketch,
  line: SketchLine,
  arc: SketchArc,
): Omit<IntersectionResult, "otherPrimId">[] {
  const ends = getLineEndpoints(sketch, line);
  const center = getCircleCenter(sketch, arc);
  const angles = getArcAngles(sketch, arc);
  if (!ends || !center || !angles) return [];

  const ixs = lineCircleIntersect(ends.p1, ends.p2, center, arc.radius);
  return ixs
    .filter(ix =>
      ix.t >= -1e-6 && ix.t <= 1 + 1e-6 &&
      isAngleInArcRange(ix.angle, angles.startAngle, angles.endAngle),
    )
    .map(ix => ({ point: ix.point, tSource: ix.t, tOther: ix.angle }));
}

function intersectCircleCircle(
  sketch: Sketch,
  c1: SketchCircle,
  c2: SketchCircle,
): Omit<IntersectionResult, "otherPrimId">[] {
  const center1 = getCircleCenter(sketch, c1);
  const center2 = getCircleCenter(sketch, c2);
  if (!center1 || !center2) return [];

  return circleCircleIntersect(center1, c1.radius, center2, c2.radius)
    .map(ix => ({ point: ix.point, tSource: ix.angle1, tOther: ix.angle2 }));
}

function intersectCircleArc(
  sketch: Sketch,
  circle: SketchCircle,
  arc: SketchArc,
): Omit<IntersectionResult, "otherPrimId">[] {
  const center1 = getCircleCenter(sketch, circle);
  const center2 = getCircleCenter(sketch, arc);
  const angles = getArcAngles(sketch, arc);
  if (!center1 || !center2 || !angles) return [];

  return circleCircleIntersect(center1, circle.radius, center2, arc.radius)
    .filter(ix => isAngleInArcRange(ix.angle2, angles.startAngle, angles.endAngle))
    .map(ix => ({ point: ix.point, tSource: ix.angle1, tOther: ix.angle2 }));
}

function intersectArcArc(
  sketch: Sketch,
  arc1: SketchArc,
  arc2: SketchArc,
): Omit<IntersectionResult, "otherPrimId">[] {
  const center1 = getCircleCenter(sketch, arc1);
  const center2 = getCircleCenter(sketch, arc2);
  const angles1 = getArcAngles(sketch, arc1);
  const angles2 = getArcAngles(sketch, arc2);
  if (!center1 || !center2 || !angles1 || !angles2) return [];

  return circleCircleIntersect(center1, arc1.radius, center2, arc2.radius)
    .filter(ix =>
      isAngleInArcRange(ix.angle1, angles1.startAngle, angles1.endAngle) &&
      isAngleInArcRange(ix.angle2, angles2.startAngle, angles2.endAngle),
    )
    .map(ix => ({ point: ix.point, tSource: ix.angle1, tOther: ix.angle2 }));
}

// ── Trim segment identification ──

/**
 * Given a line or arc with sorted intersection points, identify which segment
 * the cursor is in so the user can trim it away.
 * Returns the t-parameter range [startParam, endParam] of the segment to remove.
 * For lines: t is in [0,1]. For arcs: t is an angle.
 */
export function identifyTrimSegment(
  sketch: Sketch,
  primId: string,
  intersections: IntersectionResult[],
  cursorPoint: { x: number; y: number },
): { startParam: number; endParam: number } | null {
  const prim = sketch.primitives.find(p => p.id === primId);
  if (!prim || isSketchPoint(prim)) return null;

  if (intersections.length === 0) return null;

  if (isSketchLine(prim)) {
    return identifyLineTrimSegment(sketch, prim, intersections, cursorPoint);
  }

  if (isSketchCircle(prim)) {
    return identifyCircleTrimSegment(sketch, prim, intersections, cursorPoint);
  }

  if (isSketchArc(prim)) {
    return identifyArcTrimSegment(sketch, prim, intersections, cursorPoint);
  }

  return null;
}

function identifyLineTrimSegment(
  sketch: Sketch,
  line: SketchLine,
  intersections: IntersectionResult[],
  cursorPoint: { x: number; y: number },
): { startParam: number; endParam: number } | null {
  const ends = getLineEndpoints(sketch, line);
  if (!ends) return null;

  // Compute cursor's t parameter on the line
  const dx = ends.p2.x - ends.p1.x;
  const dy = ends.p2.y - ends.p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return null;

  const cursorT = ((cursorPoint.x - ends.p1.x) * dx + (cursorPoint.y - ends.p1.y) * dy) / len2;

  // Sort intersection t-values, bookended by 0 and 1
  const tValues = [0, ...intersections.map(ix => ix.tSource).sort((a, b) => a - b), 1];

  // Find which segment contains cursorT
  for (let i = 0; i < tValues.length - 1; i++) {
    if (cursorT >= tValues[i] - 1e-6 && cursorT <= tValues[i + 1] + 1e-6) {
      return { startParam: tValues[i], endParam: tValues[i + 1] };
    }
  }

  return null;
}

function identifyCircleTrimSegment(
  sketch: Sketch,
  circle: SketchCircle,
  intersections: IntersectionResult[],
  cursorPoint: { x: number; y: number },
): { startParam: number; endParam: number } | null {
  const center = getCircleCenter(sketch, circle);
  if (!center) return null;

  if (intersections.length < 2) return null;

  const cursorAngle = normalizeAngle(
    Math.atan2(cursorPoint.y - center.y, cursorPoint.x - center.x),
  );

  // Sort intersection angles
  const angles = intersections.map(ix => normalizeAngle(ix.tSource)).sort((a, b) => a - b);

  // Find which arc segment contains cursorAngle
  for (let i = 0; i < angles.length; i++) {
    const start = angles[i];
    const end = angles[(i + 1) % angles.length];
    if (isAngleInArcRange(cursorAngle, start, end)) {
      return { startParam: start, endParam: end };
    }
  }

  return null;
}

function identifyArcTrimSegment(
  sketch: Sketch,
  arc: SketchArc,
  intersections: IntersectionResult[],
  cursorPoint: { x: number; y: number },
): { startParam: number; endParam: number } | null {
  const center = getCircleCenter(sketch, arc);
  const arcAngles = getArcAngles(sketch, arc);
  if (!center || !arcAngles) return null;

  const cursorAngle = Math.atan2(cursorPoint.y - center.y, cursorPoint.x - center.x);

  // Build segments: arc start angle, intersections, arc end angle
  const tValues = [
    arcAngles.startAngle,
    ...intersections.map(ix => ix.tSource).sort((a, b) => a - b),
    arcAngles.endAngle,
  ];

  // Find which segment contains cursorAngle
  for (let i = 0; i < tValues.length - 1; i++) {
    if (isAngleInArcRange(cursorAngle, tValues[i], tValues[i + 1])) {
      return { startParam: tValues[i], endParam: tValues[i + 1] };
    }
  }

  return null;
}

// ── Extend helpers ──

/**
 * Find the nearest primitive endpoint within snap distance.
 */
export function findClosestEndpoint(
  sketch: Sketch,
  cursorPoint: { x: number; y: number },
  snapDist: number,
): { primitiveId: string; pointId: string; isStart: boolean } | null {
  let bestDist = snapDist;
  let best: { primitiveId: string; pointId: string; isStart: boolean } | null = null;

  for (const prim of sketch.primitives) {
    if (isSketchLine(prim)) {
      const pt1 = getPointById(sketch, prim.p1Id);
      const pt2 = getPointById(sketch, prim.p2Id);
      if (pt1) {
        const d = Math.hypot(pt1.x - cursorPoint.x, pt1.y - cursorPoint.y);
        if (d < bestDist) {
          bestDist = d;
          best = { primitiveId: prim.id, pointId: prim.p1Id, isStart: true };
        }
      }
      if (pt2) {
        const d = Math.hypot(pt2.x - cursorPoint.x, pt2.y - cursorPoint.y);
        if (d < bestDist) {
          bestDist = d;
          best = { primitiveId: prim.id, pointId: prim.p2Id, isStart: false };
        }
      }
    }
    if (isSketchArc(prim)) {
      const startPt = getPointById(sketch, prim.startId);
      const endPt = getPointById(sketch, prim.endId);
      if (startPt) {
        const d = Math.hypot(startPt.x - cursorPoint.x, startPt.y - cursorPoint.y);
        if (d < bestDist) {
          bestDist = d;
          best = { primitiveId: prim.id, pointId: prim.startId, isStart: true };
        }
      }
      if (endPt) {
        const d = Math.hypot(endPt.x - cursorPoint.x, endPt.y - cursorPoint.y);
        if (d < bestDist) {
          bestDist = d;
          best = { primitiveId: prim.id, pointId: prim.endId, isStart: false };
        }
      }
    }
  }

  return best;
}

/**
 * Find the nearest intersection point when extending a line from its endpoint.
 * Extends the line infinitely from the given endpoint and finds the closest
 * intersection with any other primitive.
 */
export function findNearestExtendTarget(
  sketch: Sketch,
  lineId: string,
  isStart: boolean,
): { point: { x: number; y: number }; targetPrimId: string } | null {
  const line = sketch.primitives.find(p => p.id === lineId && isSketchLine(p)) as SketchLine | undefined;
  if (!line) return null;

  const ends = getLineEndpoints(sketch, line);
  if (!ends) return null;

  // Extend from the specified endpoint in the natural direction
  const extendFrom = isStart ? ends.p1 : ends.p2;
  const extendTo = isStart ? ends.p2 : ends.p1;

  // Direction from extendTo toward extendFrom, then beyond
  const dx = extendFrom.x - extendTo.x;
  const dy = extendFrom.y - extendTo.y;

  // Create a very long extended line
  const farPoint = {
    x: extendFrom.x + dx * 1000,
    y: extendFrom.y + dy * 1000,
  };

  let bestDist = Infinity;
  let bestResult: { point: { x: number; y: number }; targetPrimId: string } | null = null;

  for (const otherPrim of sketch.primitives) {
    if (otherPrim.id === lineId) continue;
    if (isSketchPoint(otherPrim)) continue;

    let intersections: { point: { x: number; y: number }; t: number }[] = [];

    if (isSketchLine(otherPrim)) {
      const otherEnds = getLineEndpoints(sketch, otherPrim);
      if (!otherEnds) continue;
      const ix = lineLineIntersect(extendFrom, farPoint, otherEnds.p1, otherEnds.p2);
      if (ix && ix.t > 1e-6 && ix.u >= -1e-6 && ix.u <= 1 + 1e-6) {
        intersections.push({ point: ix.point, t: ix.t });
      }
    } else if (isSketchCircle(otherPrim)) {
      const center = getCircleCenter(sketch, otherPrim);
      if (!center) continue;
      const ixs = lineCircleIntersect(extendFrom, farPoint, center, otherPrim.radius);
      intersections = ixs.filter(ix => ix.t > 1e-6);
    } else if (isSketchArc(otherPrim)) {
      const center = getCircleCenter(sketch, otherPrim);
      const angles = getArcAngles(sketch, otherPrim);
      if (!center || !angles) continue;
      const ixs = lineCircleIntersect(extendFrom, farPoint, center, otherPrim.radius);
      intersections = ixs.filter(ix =>
        ix.t > 1e-6 &&
        isAngleInArcRange(ix.angle, angles.startAngle, angles.endAngle),
      );
    }

    for (const ix of intersections) {
      const dist = Math.hypot(ix.point.x - extendFrom.x, ix.point.y - extendFrom.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestResult = { point: ix.point, targetPrimId: otherPrim.id };
      }
    }
  }

  return bestResult;
}
