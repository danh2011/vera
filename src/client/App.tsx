import { useEffect, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.js";
import { ChatPage } from "./pages/ChatPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DataPage } from "./pages/DataPage.js";
import { api } from "./api.js";
import { setupGlobalKeyboardShortcuts } from "./keyboard.js";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        const theme = s.theme ?? "system";
        applyTheme(theme);
      })
      .catch(() => {});
  }, []);

  // Setup global keyboard shortcuts (v0.1.1)
  useEffect(() => {
    const cleanup = setupGlobalKeyboardShortcuts({
      onNewChat: () => navigate("/"),
      onSettings: () => navigate("/settings"),
      onSearch: () => {
        // Placeholder for future search functionality
        console.log("[vera] search not yet implemented");
      },
    });
    return cleanup;
  }, [navigate]);

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        refreshKey={refreshKey}
      />
      <Routes>
        <Route
          path="/"
          element={<ChatPage onMenuClick={() => setSidebarOpen(true)} onConversationChange={() => setRefreshKey((k) => k + 1)} />}
        />
        <Route
          path="/c/:conversationId"
          element={<ChatPage onMenuClick={() => setSidebarOpen(true)} onConversationChange={() => setRefreshKey((k) => k + 1)} />}
        />
        <Route path="/settings" element={<SettingsPage onMenuClick={() => setSidebarOpen(true)} />} />
        <Route path="/data/:kind" element={<DataPage onMenuClick={() => setSidebarOpen(true)} />} />
      </Routes>
    </div>
  );
}
 
function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}
