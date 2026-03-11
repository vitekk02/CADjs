/**
 * Type definitions for OCC Web Worker communication.
 * All THREE.js types are replaced with plain {x,y,z} / typed arrays.
 * All BRep classes are replaced with JSON serialization.
 */

import type { BrepJSON, CompoundBrepJSON } from "../geometry";
import type { SketchPrimitive, SketchConstraint, SketchPlane } from "../types/sketch-types";

// ─── Position / Vector types (no THREE.js dependency) ──────────────

export interface Vec3 { x: number; y: number; z: number }
export interface EulerJSON { x: number; y: number; z: number; order: string }

// ─── Request types ─────────────────────────────────────────────────

export interface WorkerRequestBase {
  id: string;
  type: string;
}

// Heavy geometry operations
export interface ExtrudeRequest extends WorkerRequestBase {
  type: "extrude";
  payload: {
    brepJson: BrepJSON;
    depth: number;
    direction: number;
    normalVec?: Vec3;
    sourceOccBrep?: string;
  };
}

export interface SweepRequest extends WorkerRequestBase {
  type: "sweep";
  payload: {
    brepJson: BrepJSON;
    profilePosition: Vec3;
    pathPoints: Vec3[];
    options?: { orientation: "perpendicular" | "parallel"; cornerMode: "right" | "round" };
    sourceOccBrep?: string;
  };
}

export interface LoftRequest extends WorkerRequestBase {
  type: "loft";
  payload: {
    profiles: Array<{
      brepJson: BrepJSON;
      position: Vec3;
      occBrep?: string;
    }>;
    isRuled?: boolean;
  };
}

export interface RevolveRequest extends WorkerRequestBase {
  type: "revolve";
  payload: {
    brepJson: BrepJSON;
    profilePosition: Vec3;
    axisOrigin: Vec3;
    axisDir: Vec3;
    angleRadians?: number;
    sourceOccBrep?: string;
    direction?: "one" | "two" | "symmetric";
    angleRadians2?: number;
  };
}

export interface FilletRequest extends WorkerRequestBase {
  type: "fillet";
  payload: {
    brepJson: BrepJSON;
    position: Vec3;
    edgeIndices: number[];
    radius: number;
    occBrep?: string;
    rotation?: EulerJSON;
  };
}

export interface ChamferRequest extends WorkerRequestBase {
  type: "chamfer";
  payload: {
    brepJson: BrepJSON;
    position: Vec3;
    edgeIndices: number[];
    distance: number;
    occBrep?: string;
    rotation?: EulerJSON;
  };
}

export interface BooleanRequest extends WorkerRequestBase {
  type: "boolean";
  payload: {
    operation: "union" | "difference" | "intersection";
    operands: Array<{
      brepJson: BrepJSON;
      position: Vec3;
      occBrep?: string;
      isCompound?: boolean;
      compoundBrepJson?: CompoundBrepJSON;
      rotation?: EulerJSON;
    }>;
    options?: {
      targetId?: string;
      toolIds?: string[];
      keepTools?: boolean;
    };
  };
}

// Edge analysis (for fillet/revolve/measure overlays)
export interface EdgeAnalysisRequest extends WorkerRequestBase {
  type: "edgeAnalysis";
  payload: {
    brepJson: BrepJSON;
    position: Vec3;
    occBrep?: string;
    rotation?: EulerJSON;
    allEdges?: boolean;
  };
}

// Preview geometry (extrude preview)
export interface PreviewGeometryRequest extends WorkerRequestBase {
  type: "previewGeometry";
  payload: {
    brepJson: BrepJSON;
    sourceOccBrep?: string;
    normalVec?: Vec3;
  };
}

// Sketch conversion
export interface SketchToBrepRequest extends WorkerRequestBase {
  type: "sketchToBrep";
  payload: {
    primitives: SketchPrimitive[];
    plane: SketchPlane;
  };
}

export interface SketchToProfilesRequest extends WorkerRequestBase {
  type: "sketchToProfiles";
  payload: {
    primitives: SketchPrimitive[];
    plane: SketchPlane;
    sketchId: string;
  };
}

// Profile processing (edge/vertex extraction for visualization)
export interface ProcessProfileRequest extends WorkerRequestBase {
  type: "processProfile";
  payload: {
    brepJson: BrepJSON;
    occBrep?: string;
  };
}

// Compound unification
export interface UnifyCompoundRequest extends WorkerRequestBase {
  type: "unifyCompound";
  payload: {
    childrenBrepJson: BrepJSON[];
  };
}

// Import/Export
export interface ImportFileRequest extends WorkerRequestBase {
  type: "importFile";
  payload: {
    fileBytes: Uint8Array;
    format: "step" | "stl" | "iges";
    fileName?: string;
  };
}

export interface ExportFileRequest extends WorkerRequestBase {
  type: "exportFile";
  payload: {
    elements: Array<{
      brepJson: BrepJSON;
      position: Vec3;
      occBrep?: string;
      rotation?: EulerJSON;
    }>;
    format: "step" | "stl" | "iges";
  };
}

// Measure operations
export interface EdgeLengthRequest extends WorkerRequestBase {
  type: "edgeLength";
  payload: {
    brepJson: BrepJSON;
    position: Vec3;
    edgeIndex: number;
    occBrep?: string;
    rotation?: EulerJSON;
  };
}

export interface EdgeDirectionRequest extends WorkerRequestBase {
  type: "edgeDirection";
  payload: {
    brepJson: BrepJSON;
    position: Vec3;
    edgeIndex: number;
    occBrep?: string;
    rotation?: EulerJSON;
  };
}

// Sketch wire (for sweep path)
export interface SketchToWireRequest extends WorkerRequestBase {
  type: "sketchToWire";
  payload: {
    primitives: SketchPrimitive[];
    plane: SketchPlane;
  };
}

// Control messages
export interface CancelRequest extends WorkerRequestBase {
  type: "__cancel";
  payload: { targetId: string };
}

export interface InitRequest extends WorkerRequestBase {
  type: "__init";
  payload?: Record<string, never>;
}

export type WorkerRequest =
  | ExtrudeRequest
  | SweepRequest
  | LoftRequest
  | RevolveRequest
  | FilletRequest
  | ChamferRequest
  | BooleanRequest
  | EdgeAnalysisRequest
  | PreviewGeometryRequest
  | SketchToBrepRequest
  | SketchToProfilesRequest
  | ProcessProfileRequest
  | UnifyCompoundRequest
  | ImportFileRequest
  | ExportFileRequest
  | EdgeLengthRequest
  | EdgeDirectionRequest
  | SketchToWireRequest
  | CancelRequest
  | InitRequest;

// ─── Response types ────────────────────────────────────────────────

export interface WorkerResponse {
  id: string;
  status: "success" | "error" | "cancelled";
  result?: unknown;
  error?: string;
}

// ─── Result types (returned inside WorkerResponse.result) ──────────

export interface WorkerGeometryResult {
  brepJson: BrepJSON;
  positionOffset: Vec3;
  occBrep?: string;
  edgePositions?: Float32Array;
  vertexPositions?: Float32Array;
  faceGeometry?: { positions: Float32Array; indices: Uint32Array; normals: Float32Array };
}

export interface WorkerBooleanResult {
  brepJson: BrepJSON;
  position: Vec3;
  occBrep?: string;
  edgePositions?: Float32Array;
  vertexPositions?: Float32Array;
  faceGeometry?: { positions: Float32Array; indices: Uint32Array; normals: Float32Array };
  compoundBrepJson?: CompoundBrepJSON;
  removedNodeIds: string[];
}

export interface WorkerEdgeAnalysisResult {
  edges: Array<{
    edgeIndex: number;
    segments: Float32Array;
    midpoint: Vec3;
  }>;
}

export interface WorkerPreviewResult {
  faceGeometry: { positions: Float32Array; indices: Uint32Array; normals: Float32Array };
}

export interface WorkerSketchBrepResult {
  brepJson: BrepJSON;
}

export interface WorkerSketchProfilesResult {
  profiles: Array<{
    id: string;
    brepJson: BrepJSON;
    area: number;
    isOuter: boolean;
    center: Vec3;
    occBrep?: string;
  }>;
  success: boolean;
}

export interface WorkerProcessProfileResult {
  edgePositions?: Float32Array;
  vertexPositions?: Float32Array;
  occBrep?: string;
}

export interface WorkerImportResult {
  elements: Array<{
    brepJson: BrepJSON;
    position: Vec3;
    occBrep?: string;
    edgePositions?: Float32Array;
    vertexPositions?: Float32Array;
  }>;
}

export interface WorkerExportResult {
  fileBytes: Uint8Array;
}

export interface WorkerEdgeLengthResult {
  length: number;
}

export interface WorkerEdgeDirectionResult {
  direction: Vec3;
}

export interface WorkerSketchWireResult {
  points: Vec3[];
}
