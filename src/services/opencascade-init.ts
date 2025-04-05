// src/services/opencascade-init.ts
import opencascadeWasm from "opencascade.js/dist/opencascade.full.wasm?url";
import opencascadeJs from "opencascade.js";

export async function initializeOpenCascade() {
  // The opencascade.js module is expecting to be initialized with the WASM URL
  const initOpenCascade = opencascadeJs.default || opencascadeJs;
  return await initOpenCascade({
    locateFile: (file: string) => {
      if (file.endsWith(".wasm")) {
        return opencascadeWasm;
      }
      return file;
    },
  });
}
