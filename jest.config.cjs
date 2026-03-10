module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    // Handle Vite's ?url import suffix - return a mock that provides the path
    "^(.+)\\.wasm\\?url$": "<rootDir>/tests/__mocks__/wasmUrlMock.js",
    // Map planegcs - required because planegcs WASM initialization uses import.meta.url
    // which babel-plugin-transform-import-meta cannot fully transform due to internal _require setup
    "^@salusoft89/planegcs$": "<rootDir>/tests/__mocks__/@salusoft89/planegcs.js",
    // Map OccWorkerClient - uses import.meta.url for Worker which Jest can't parse in CommonJS mode
    // Pattern matches both "../services/OccWorkerClient" and "./OccWorkerClient" imports
    "(.*/|\\./)?OccWorkerClient$": "<rootDir>/tests/__mocks__/OccWorkerClient.js",
  },
  transform: {
    // TypeScript files
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: {
        module: "CommonJS",
        moduleResolution: "node",
        esModuleInterop: true,
        allowJs: true,
        skipLibCheck: true,
        noEmit: true,
      },
      diagnostics: {
        // Ignore specific TypeScript errors
        ignoreCodes: [2307, 2554, 2345, 2538, 18047, 2344, 1343],
      },
    }],
    // Transform opencascade.js and planegcs from ESM to CommonJS
    "node_modules/opencascade\\.js/.+\\.(js|mjs)$": "babel-jest",
    "node_modules/@salusoft89/planegcs/.+\\.(js|mjs)$": "babel-jest",
    // Transform three/examples ESM modules (Line2, LineMaterial, etc.)
    "node_modules/three/examples/.+\\.js$": "babel-jest",
  },
  transformIgnorePatterns: [
    // Transform opencascade.js, planegcs, and three/examples (don't ignore them)
    "/node_modules/(?!(opencascade\\.js|@salusoft89/planegcs|three/examples)/)",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testTimeout: 60000,
  maxWorkers: 1,
};
