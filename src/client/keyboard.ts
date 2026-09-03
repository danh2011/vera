/**
 * Keyboard shortcuts for Vera.
 * Cross-platform (handles both Cmd on Mac and Ctrl on Windows/Linux).
 */

export function isModifierKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

export function isModifierEnter(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === "Enter";
}

export function setupGlobalKeyboardShortcuts(callbacks: {
  onNewChat?: () => void;
  onSettings?: () => void;
  onSearch?: () => void;
}): () => void {
  const handleKeydown = (e: KeyboardEvent) => {
    // Cmd/Ctrl+K: New chat
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      callbacks.onNewChat?.();
    }
    // Cmd/Ctrl+,: Settings
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      callbacks.onSettings?.();
    }
    // Cmd/Ctrl+/: Search (placeholder for future)
    if ((e.metaKey || e.ctrlKey) && e.key === "/") {
      e.preventDefault();
      callbacks.onSearch?.();
    }
  };

  window.addEventListener("keydown", handleKeydown);
  return () => window.removeEventListener("keydown", handleKeydown);
}

export const KEYBOARD_HINTS = {
  send: "Enter or Cmd+Enter",
  newChat: "Cmd+K",
  settings: "Cmd+,",
  search: "Cmd+/",
};
