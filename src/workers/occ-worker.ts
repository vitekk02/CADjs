/**
 * OCC Web Worker entry point.
 * Initializes opencascade.js WASM and routes messages to handler functions.
 */

import type { OpenCascadeInstance } from "opencascade.js";
import opencascade from "opencascade.js/dist/opencascade.full.js";
import opencascadeWasm from "opencascade.js/dist/opencascade.full.wasm?url";
import type { WorkerRequest, WorkerResponse } from "./occ-worker-types";
import { collectTransferables } from "./geometry-reconstruction";
import { dispatchOccRequest } from "./occ-dispatch";

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
    const result = dispatchOccRequest(oc, request.type, request.payload);

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
