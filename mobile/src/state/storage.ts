import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const K = { settings: "vera:settings:v1", server: "vera:server:v1", cookie: "vera.session" } as const;

async function readJson<T>(key: string): Promise<T | null> { try { const raw = await AsyncStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; } }

export const store = {
  readSettings: <T,>() => readJson<T>(K.settings),
  writeSettings: async (v: unknown) => { try { await AsyncStorage.setItem(K.settings, JSON.stringify(v)); } catch { /* settings are a convenience; failing to save must never block the app */ } },
  readServer: async () => { try { return await AsyncStorage.getItem(K.server); } catch { return null; } },
  writeServer: async (url: string | null) => { try { if (url) await AsyncStorage.setItem(K.server, url); else await AsyncStorage.removeItem(K.server); } catch { /* ignore */ } },
  /** The session token is a credential: secure storage only. */
  readCookie: async () => { try { return await SecureStore.getItemAsync(K.cookie); } catch { return null; } },
  writeCookie: async (token: string | null) => { try { if (token) await SecureStore.setItemAsync(K.cookie, token); else await SecureStore.deleteItemAsync(K.cookie); } catch { /* ignore */ } },
};
