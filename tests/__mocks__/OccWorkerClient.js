// Smart mock for OccWorkerClient that routes through the real OCC dispatch logic.
// Only the Worker transport is bypassed — all handler/helper functions run for real.
//
// IMPORTANT: OpenCascadeService and dispatchOccRequest are required lazily inside send()
// to break a circular dependency: mock → OpenCascadeService → convertBRepToGeometry →
// scene-operations/index → union-operations → OccWorkerClient (this mock, still loading).

class OccWorkerClient {
  static instance = null;

  static getInstance() {
    if (!OccWorkerClient.instance) {
      OccWorkerClient.instance = new OccWorkerClient();
    }
    return OccWorkerClient.instance;
  }

  static isAvailable() {
    return true;
  }

  async waitForReady() {
    return Promise.resolve();
  }

  async send(request) {
    // Lazy require to avoid circular dependency at module load time
    const { OpenCascadeService } = require("../../src/services/OpenCascadeService");
    const { dispatchOccRequest } = require("../../src/workers/occ-dispatch");
    const oc = await OpenCascadeService.getInstance().getOC();
    return dispatchOccRequest(oc, request.type, request.payload);
  }

  cancel() {}

  dispose() {
    OccWorkerClient.instance = null;
  }
}

module.exports = { OccWorkerClient };
