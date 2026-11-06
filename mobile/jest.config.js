const preset = require("jest-expo/jest-preset");

module.exports = {
  ...preset,
  setupFiles: [...(preset.setupFiles ?? []), "<rootDir>/jest.setup.js"],
  moduleNameMapper: { ...(preset.moduleNameMapper ?? {}), "^@/(.*)$": "<rootDir>/src/$1" },
  testPathIgnorePatterns: ["/node_modules/", "/android/", "/dist/"],
};
