import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.js";
import { ChatPage } from "./pages/ChatPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DataPage } from "./pages/DataPage.js";
import { api } from "./api.js";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        const theme = s.theme ?? "system";
        applyTheme(theme);
      })
      .catch(() => {});
  }, []);

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
