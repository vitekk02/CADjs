/**
 * Shared dispatch function for OCC worker requests.
 * Used by both the actual Web Worker and the test mock to route
 * request types to handler functions.
 */

import type { OpenCascadeInstance } from "opencascade.js";
import type { WorkerRequest } from "./occ-worker-types";
import {
  handleExtrude,
  handleSweep,
  handleLoft,
  handleRevolve,
  handleFillet,
  handleChamfer,
  handleBoolean,
  handleEdgeAnalysis,
  handlePreviewGeometry,
  handleSketchToBrep,
  handleSketchToProfiles,
  handleProcessProfile,
  handleUnifyCompound,
  handleImportFile,
  handleExportFile,
  handleEdgeLength,
  handleEdgeDirection,
  handleSketchToWire,
} from "./occ-worker-handlers";

export function dispatchOccRequest(oc: OpenCascadeInstance, type: string, payload: any): unknown {
  switch (type) {
    case "extrude":
      return handleExtrude(oc, payload);
    case "sweep":
      return handleSweep(oc, payload);
    case "loft":
      return handleLoft(oc, payload);
    case "revolve":
      return handleRevolve(oc, payload);
    case "fillet":
      return handleFillet(oc, payload);
    case "chamfer":
      return handleChamfer(oc, payload);
    case "boolean":
      return handleBoolean(oc, payload);
    case "edgeAnalysis":
      return handleEdgeAnalysis(oc, payload);
    case "previewGeometry":
      return handlePreviewGeometry(oc, payload);
    case "sketchToBrep":
      return handleSketchToBrep(oc, payload);
    case "sketchToProfiles":
      return handleSketchToProfiles(oc, payload);
    case "processProfile":
      return handleProcessProfile(oc, payload);
    case "unifyCompound":
      return handleUnifyCompound(oc, payload);
    case "importFile":
      return handleImportFile(oc, payload);
    case "exportFile":
      return handleExportFile(oc, payload);
    case "edgeLength":
      return handleEdgeLength(oc, payload);
    case "edgeDirection":
      return handleEdgeDirection(oc, payload);
    case "sketchToWire":
      return handleSketchToWire(oc, payload);
    default:
      throw new Error(`Unknown request type: ${type}`);
  }
}
