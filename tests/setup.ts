// Jest setup file for OpenCascade tests

// Increase timeout for WASM loading
jest.setTimeout(60000);

// Global error handler for unhandled promises
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
