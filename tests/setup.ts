// Jest setup file for OpenCascade tests
import { OpenCascadeService } from "../src/services/OpenCascadeService";

// Increase timeout for WASM loading
jest.setTimeout(60000);

// Initialize OpenCascade once before all tests
beforeAll(async () => {
  const ocService = OpenCascadeService.getInstance();
  await ocService.getOC();
}, 60000);

// Global error handler for unhandled promises
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
