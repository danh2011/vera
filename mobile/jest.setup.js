jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    getItemAsync: async (k) => store.get(k) ?? null,
    setItemAsync: async (k, v) => { store.set(k, v); },
    deleteItemAsync: async (k) => { store.delete(k); },
  };
});
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
// The icon set ships ESM only and icons are irrelevant to logic tests.
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? t[k] : () => null) }));
