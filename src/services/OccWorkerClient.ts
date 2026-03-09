/**
 * Main-thread singleton that communicates with the OCC Web Worker.
 * All OCC operations go through this client as pipeline-level messages.
 */

import type { WorkerRequest, WorkerResponse } from "../workers/occ-worker-types";
import { collectTransferables } from "../workers/geometry-reconstruction";

export class OccWorkerClient {
  private static instance: OccWorkerClient;
  private worker: Worker;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();
  private ready = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  private constructor() {
    this.worker = new Worker(
      new URL("../workers/occ-worker.ts", import.meta.url),
      { type: "module" },
    );
    this.readyPromise = new Promise(resolve => { this.readyResolve = resolve; });
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);

    // Send init message to start WASM loading in worker
    this.worker.postMessage({ id: "__init", type: "__init" } satisfies WorkerRequest);
  }

  static getInstance(): OccWorkerClient {
    if (!OccWorkerClient.instance) {
      OccWorkerClient.instance = new OccWorkerClient();
    }
    return OccWorkerClient.instance;
  }

  /**
   * Returns true once the worker's WASM module is ready.
   */
  static isAvailable(): boolean {
    return OccWorkerClient.instance?.ready ?? false;
  }

  /**
   * Wait for the worker WASM to be ready.
   */
  async waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Send a request to the worker and return a Promise for the result.
   * Uses UUID-based correlation and zero-copy transfer for typed arrays.
   */
  async send<T = unknown>(
    request: Omit<WorkerRequest, "id">,
  ): Promise<T> {
    await this.readyPromise;

    const id = crypto.randomUUID();
    const fullRequest = { ...request, id } as WorkerRequest;

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Collect transferable ArrayBuffers for zero-copy
      const transferables = collectTransferables((fullRequest as any).payload);
      if (transferables.length > 0) {
        this.worker.postMessage(fullRequest, transferables);
      } else {
        this.worker.postMessage(fullRequest);
      }
    });
  }

  /**
   * Cooperative cancellation — sends cancel message to worker.
   * Worker checks the cancelled set and skips work if possible.
   */
  cancel(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.reject(new Error("Cancelled"));
      this.pendingRequests.delete(requestId);
    }
    this.worker.postMessage({
      id: crypto.randomUUID(),
      type: "__cancel",
      payload: { targetId: requestId },
    } satisfies WorkerRequest);
  }

  /**
   * Cleanup: terminate worker and reject pending requests.
   */
  dispose(): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Worker disposed"));
    }
    this.pendingRequests.clear();
    this.worker.terminate();
    OccWorkerClient.instance = null as any;
  }

  private handleMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;

    // Handle init response
    if (response.id === "__init") {
      if (response.status === "success") {
        this.ready = true;
        this.readyResolve();
        console.log("[OccWorkerClient] Worker WASM ready");
      } else {
        console.error("[OccWorkerClient] Worker WASM init failed:", response.error);
      }
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (!pending) return; // Already cancelled or unknown

    this.pendingRequests.delete(response.id);

    if (response.status === "success") {
      pending.resolve(response.result);
    } else if (response.status === "cancelled") {
      pending.reject(new Error("Operation cancelled"));
    } else {
      pending.reject(new Error(response.error || "Worker operation failed"));
    }
  }

  private handleError(event: ErrorEvent): void {
    console.error("[OccWorkerClient] Worker error:", event.message);

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error(`Worker error: ${event.message}`));
    }
    this.pendingRequests.clear();

    // Auto-restart worker
    this.ready = false;
    this.readyPromise = new Promise(resolve => { this.readyResolve = resolve; });
    this.worker.terminate();
    this.worker = new Worker(
      new URL("../workers/occ-worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
    this.worker.postMessage({ id: "__init", type: "__init" } satisfies WorkerRequest);
  }
}
