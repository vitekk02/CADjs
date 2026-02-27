import * as THREE from "three";

// Sketch plane types
export type SketchPlaneType = "XY" | "XZ" | "YZ";

export interface SketchPlane {
  type: SketchPlaneType;
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  xAxis: THREE.Vector3;
  yAxis: THREE.Vector3;
}

// Primitive types for planegcs compatibility
export type SketchPrimitiveType = "point" | "line" | "circle" | "arc" | "ellipse";

export interface SketchPoint {
  id: string;
  type: "point";
  x: number;
  y: number;
  fixed?: boolean;
}

export interface SketchLine {
  id: string;
  type: "line";
  p1Id: string; // Reference to point
  p2Id: string;
  construction?: boolean; // Construction line (orange dashed, excluded from BRep)
}

export interface SketchCircle {
  id: string;
  type: "circle";
  centerId: string; // Reference to center point
  radius: number;
  construction?: boolean; // Construction circle
}

export interface SketchArc {
  id: string;
  type: "arc";
  centerId: string;
  startId: string;
  endId: string;
  radius: number;
  construction?: boolean; // Construction arc
}

export interface SketchEllipse {
  id: string;
  type: "ellipse";
  centerId: string;
  focus1Id: string;
  radiusMinor: number;
}

export type SketchPrimitive =
  | SketchPoint
  | SketchLine
  | SketchCircle
  | SketchArc
  | SketchEllipse;

// Constraint types matching planegcs API
export type GeometricConstraintType =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "equal"
  | "symmetric"
  | "concentric"
  | "pointOnLine"
  | "pointOnCircle"
  | "midpoint";

export type DimensionalConstraintType =
  | "distance"
  | "distanceX"
  | "distanceY"
  | "angle"
  | "radius"
  | "diameter";

export type ConstraintType = GeometricConstraintType | DimensionalConstraintType;

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  primitiveIds: string[];
  value?: number; // For dimensional constraints
  driving?: boolean; // True = driving constraint, false = reference/driven
}

// Sketch status
export type SketchStatus =
  | "underconstrained"
  | "fully_constrained"
  | "overconstrained";

// Main Sketch interface
export interface Sketch {
  id: string;
  plane: SketchPlane;
  primitives: SketchPrimitive[];
  constraints: SketchConstraint[];
  dof: number; // Degrees of freedom remaining
  status: SketchStatus;
}

// Solve result
export interface SolveResult {
  success: boolean;
  sketch: Sketch; // Updated with solved positions
  dof: number;
  status: SketchStatus;
  redundantConstraintIds?: string[];
  conflictingConstraintIds?: string[];
}

// Result of adding a constraint and solving
export type ConstraintResultStatus = "applied" | "redundant" | "conflicting" | "failed";

export interface ConstraintResult {
  sketch: Sketch | null;
  status: ConstraintResultStatus;
}

// Helper function to create default sketch planes
export function createSketchPlane(
  type: SketchPlaneType,
  origin: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
): SketchPlane {
  switch (type) {
    case "XY":
      return {
        type,
        origin: origin.clone(),
        normal: new THREE.Vector3(0, 0, 1),
        xAxis: new THREE.Vector3(1, 0, 0),
        yAxis: new THREE.Vector3(0, 1, 0),
      };
    case "XZ":
      return {
        type,
        origin: origin.clone(),
        normal: new THREE.Vector3(0, 1, 0),
        xAxis: new THREE.Vector3(1, 0, 0),
        yAxis: new THREE.Vector3(0, 0, 1),
      };
    case "YZ":
      return {
        type,
        origin: origin.clone(),
        normal: new THREE.Vector3(1, 0, 0),
        xAxis: new THREE.Vector3(0, 1, 0),
        yAxis: new THREE.Vector3(0, 0, 1),
      };
  }
}

// Type guards
export function isSketchPoint(
  primitive: SketchPrimitive,
): primitive is SketchPoint {
  return primitive.type === "point";
}

export function isSketchLine(
  primitive: SketchPrimitive,
): primitive is SketchLine {
  return primitive.type === "line";
}

export function isSketchCircle(
  primitive: SketchPrimitive,
): primitive is SketchCircle {
  return primitive.type === "circle";
}

export function isSketchArc(primitive: SketchPrimitive): primitive is SketchArc {
  return primitive.type === "arc";
}

export function isSketchEllipse(
  primitive: SketchPrimitive,
): primitive is SketchEllipse {
  return primitive.type === "ellipse";
}

// Profile types for Fusion 360-style multi-profile detection

/**
 * Represents a single profile (closed region) detected from a sketch.
 * When primitives intersect, they create multiple profiles.
 */
export interface SketchProfile {
  id: string;
  sketchId: string;
  wireIndex: number;
  isOuter: boolean;  // outer boundary vs interior region
  area: number;
}

/**
 * Result of converting a sketch to multiple profiles.
 */
export interface SketchConversionResult {
  profiles: Array<{
    id: string;
    brep: import("../geometry").Brep;  // Centered at origin (local space)
    area: number;
    isOuter: boolean;
    center: { x: number; y: number; z: number };  // World position of the profile center
  }>;
  success: boolean;
}

/**
 * Operation types for feature tree nodes.
 */
export type OperationType = "union" | "difference" | "intersection" | "extrude" | "fillet" | "chamfer";

/**
 * Feature tree node types for hierarchical display.
 */
export type FeatureNodeType = "sketch" | "profile" | "body" | "folder" | "operation";

/**
 * A node in the feature tree hierarchy.
 * Used to display sketches, profiles, and bodies in a tree view.
 */
export interface FeatureNode {
  id: string;
  type: FeatureNodeType;
  name: string;
  visible: boolean;
  expanded?: boolean;
  children?: FeatureNode[];
  sourceSketchId?: string;  // For profiles/bodies: which sketch they came from
  elementId?: string;       // Link to SceneElement.nodeId for bodies
  profileId?: string;       // For bodies: which profile they came from
  operationType?: OperationType;  // For operation nodes: which operation type
}

// ── Browser Panel types (Fusion 360-style categorical view) ─────────

export type BrowserSectionType = "origin" | "bodies" | "sketches";
export type BrowserItemType = "body" | "sketch" | "profile" | "operation" | "plane" | "axis" | "origin-point";

export interface BrowserSection {
  id: string;
  label: string;
  sectionType: BrowserSectionType;
  expanded: boolean;
  count: number;
  items: BrowserItem[];
}

export interface BrowserItem {
  id: string;
  label: string;
  itemType: BrowserItemType;
  visible: boolean;
  expanded?: boolean;
  elementId?: string;
  sourceNodeId?: string;
  children?: BrowserItem[];
  operationType?: OperationType;
}
