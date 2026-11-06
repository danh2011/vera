const expo = require("eslint-config-expo/flat");
module.exports = [
  ...expo,
  { ignores: ["dist/*", "android/*", "ios/*", ".expo/*", "node_modules/*"] },
  { rules: {
    // Apostrophes in UI copy are fine in React Native <Text>.
    "react/no-unescaped-entities": "off",
    // Resetting state when a route param changes is deliberate in these screens.
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/purity": "off",
  } },
  { files: ["jest.setup.js", "__tests__/**"], languageOptions: { globals: { jest: "readonly", describe: "readonly", it: "readonly", expect: "readonly", beforeEach: "readonly", test: "readonly" } } },
];
