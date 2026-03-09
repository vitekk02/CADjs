// Mock OccWorkerClient for Jest (import.meta.url not available in CommonJS)
class OccWorkerClient {
  static instance = null;

  static getInstance() {
    if (!OccWorkerClient.instance) {
      OccWorkerClient.instance = new OccWorkerClient();
    }
    return OccWorkerClient.instance;
  }

  static isAvailable() {
    return false;
  }

  async waitForReady() {
    return Promise.resolve();
  }

  async send(request) {
    throw new Error(`OccWorkerClient.send() not available in test environment. Request type: ${request.type}`);
  }

  cancel() {}

  dispose() {
    OccWorkerClient.instance = null;
  }
}

module.exports = { OccWorkerClient };
