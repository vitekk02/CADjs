module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    // Handle Vite's ?url import suffix - return a mock that provides the path
    "^(.+)\\.wasm\\?url$": "<rootDir>/tests/__mocks__/wasmUrlMock.js",
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
        // 18047: 'result' is possibly null
        ignoreCodes: [2307, 2554, 2345, 2538, 18047],
      },
    }],
    // Transform opencascade.js from ESM to CommonJS
    "node_modules/opencascade\\.js/.+\\.(js|mjs)$": "babel-jest",
  },
  transformIgnorePatterns: [
    // Transform opencascade.js (don't ignore it)
    "/node_modules/(?!opencascade\\.js/)",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testTimeout: 60000,
};
