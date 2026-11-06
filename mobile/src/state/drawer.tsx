import { createContext, useContext } from "react";

export interface DrawerApi { open: () => void; close: () => void; isOpen: boolean }
export const DrawerCtx = createContext<DrawerApi>({ open: () => {}, close: () => {}, isOpen: false });
export const useDrawer = () => useContext(DrawerCtx);

/** Screens call this after changing data the drawer shows (e.g. a new conversation) so it refreshes immediately. */
const listeners = new Set<() => void>();
export const notifyData = () => listeners.forEach((l) => l());
export const onData = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
