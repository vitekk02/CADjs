/**
 * OCC Web Worker entry point.
 * Initializes opencascade.js WASM and routes messages to handler functions.
 */

import type { OpenCascadeInstance } from "opencascade.js";
import opencascade from "opencascade.js/dist/opencascade.full.js";
import opencascadeWasm from "opencascade.js/dist/opencascade.full.wasm?url";
import type { WorkerRequest, WorkerResponse } from "./occ-worker-types";
import { collectTransferables } from "./geometry-reconstruction";
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

let oc: OpenCascadeInstance | null = null;
const cancelledIds = new Set<string>();

function respond(response: WorkerResponse): void {
  const transferables = collectTransferables(response.result);
  if (transferables.length > 0) {
    self.postMessage(response, transferables as any);
  } else {
    self.postMessage(response);
  }
}

async function initOC(): Promise<void> {
  try {
    oc = await opencascade({
      locateFile: () => opencascadeWasm,
    });
    respond({ id: "__init", status: "success" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    respond({ id: "__init", status: "error", error: `WASM init failed: ${msg}` });
  }
}

function handleMessage(request: WorkerRequest): void {
  // Control messages
  if (request.type === "__init") {
    initOC();
    return;
  }

  if (request.type === "__cancel") {
    cancelledIds.add(request.payload.targetId);
    return;
  }

  // Check cancellation
  if (cancelledIds.has(request.id)) {
    cancelledIds.delete(request.id);
    respond({ id: request.id, status: "cancelled" });
    return;
  }

  // Ensure OC is ready
  if (!oc) {
    respond({ id: request.id, status: "error", error: "OCC WASM not initialized" });
    return;
  }

  try {
    let result: unknown;

    switch (request.type) {
      case "extrude":
        result = handleExtrude(oc, request.payload);
        break;
      case "sweep":
        result = handleSweep(oc, request.payload);
        break;
      case "loft":
        result = handleLoft(oc, request.payload);
        break;
      case "revolve":
        result = handleRevolve(oc, request.payload);
        break;
      case "fillet":
        result = handleFillet(oc, request.payload);
        break;
      case "chamfer":
        result = handleChamfer(oc, request.payload);
        break;
      case "boolean":
        result = handleBoolean(oc, request.payload);
        break;
      case "edgeAnalysis":
        result = handleEdgeAnalysis(oc, request.payload);
        break;
      case "previewGeometry":
        result = handlePreviewGeometry(oc, request.payload);
        break;
      case "sketchToBrep":
        result = handleSketchToBrep(oc, request.payload);
        break;
      case "sketchToProfiles":
        result = handleSketchToProfiles(oc, request.payload);
        break;
      case "processProfile":
        result = handleProcessProfile(oc, request.payload);
        break;
      case "unifyCompound":
        result = handleUnifyCompound(oc, request.payload);
        break;
      case "importFile":
        result = handleImportFile(oc, request.payload);
        break;
      case "exportFile":
        result = handleExportFile(oc, request.payload);
        break;
      case "edgeLength":
        result = handleEdgeLength(oc, request.payload);
        break;
      case "edgeDirection":
        result = handleEdgeDirection(oc, request.payload);
        break;
      case "sketchToWire":
        result = handleSketchToWire(oc, request.payload);
        break;
      default: {
        const unknownRequest = request as WorkerRequest;
        respond({ id: unknownRequest.id, status: "error", error: `Unknown request type: ${(unknownRequest as any).type}` });
        return;
      }
    }

    // Check cancellation after operation
    if (cancelledIds.has(request.id)) {
      cancelledIds.delete(request.id);
      respond({ id: request.id, status: "cancelled" });
      return;
    }

    respond({ id: request.id, status: "success", result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    respond({ id: request.id, status: "error", error: msg });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  handleMessage(event.data);
};
