// Mock for WASM URL imports - returns the path to the actual WASM file
const path = require("path");
module.exports = path.resolve(__dirname, "../../node_modules/opencascade.js/dist/opencascade.full.wasm");
