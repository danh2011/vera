import { useEffect, useState } from "react";
import { api } from "../api.js";

interface Props {
  onMenuClick: () => void;
}

export function SettingsPage({ onMenuClick }: Props) {
  const [settings, setSettings] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [version, setVersion] = useState<any>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
    api.getHealth().then(setHealth).catch(() => {});
    api.getVersion().then(setVersion).catch(() => {});
  }, []);

  const updateSetting = async (key: string, value: unknown) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }));
    await api.updateSettings({ [key]: value });
    if (key === "theme") {
      const root = document.documentElement;
      if (value === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", value as string);
    }
  };

  if (!settings) return null;

  return (
    <div className="main-panel">
      <div className="topbar">
        <button className="menu-btn" onClick={onMenuClick} aria-label="Menu">
          ☰
        </button>
        <span className="brand">Settings</span>
      </div>
      <div className="settings-page">
        <h1>Settings</h1>

        <div className="settings-section">
          <div className="settings-row">
            <span>Theme</span>
            <select value={settings.theme} onChange={(e) => updateSetting("theme", e.target.value)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="settings-row">
            <span>Developer mode</span>
            <input
              type="checkbox"
              checked={!!settings.developerMode}
              onChange={(e) => updateSetting("developerMode", e.target.checked)}
            />
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <span>AI provider</span>
            <span>Google Gemini ({settings.geminiModel})</span>
          </div>
          <div className="settings-row">
            <span>Gemini configured</span>
            <span>
              <span className={`status-dot ${settings.geminiConfigured ? "ok" : "error"}`} />
              {settings.geminiConfigured ? "Yes" : "No - set GEMINI_API_KEY"}
            </span>
          </div>
          <div className="settings-row">
            <span>Data sent externally</span>
            <span>Relevant conversation/context required for your request</span>
          </div>
        </div>

        {health && (
          <div className="settings-section">
            <div className="settings-row">
              <span>Server status</span>
              <span>
                <span className={`status-dot ${health.status === "ok" ? "ok" : health.status === "degraded" ? "unknown" : "error"}`} />
                {health.status}
              </span>
            </div>
            <div className="settings-row">
              <span>Database</span>
              <span>
                <span className={`status-dot ${health.checks.database ? "ok" : "error"}`} />
                {health.checks.database ? "OK" : "Error"}
              </span>
            </div>
            <div className="settings-row">
              <span>Workspace</span>
              <span>
                <span className={`status-dot ${health.checks.workspace ? "ok" : "error"}`} />
                {health.checks.workspace ? "OK" : "Missing"}
              </span>
            </div>
          </div>
        )}

        {version && (
          <div className="settings-section">
            <div className="settings-row">
              <span>Version</span>
              <span>{version.current}</span>
            </div>
            {version.repoConfigured && (
              <div className="settings-row">
                <span>Update available</span>
                <span>{version.updateAvailable ? `Yes (${version.latest})` : "No - up to date"}</span>
              </div>
            )}
          </div>
        )}

        <div className="settings-section">
          <div className="settings-row">
            <span>Memory</span>
            <a href="/data/memories">View memories</a>
          </div>
          <div className="settings-row">
            <span>Notes</span>
            <a href="/data/notes">View notes</a>
          </div>
          <div className="settings-row">
            <span>Tasks</span>
            <a href="/data/tasks">View tasks</a>
          </div>
          <div className="settings-row">
            <span>Automations</span>
            <a href="/data/automations">View automations</a>
          </div>
        </div>
      </div>
    </div>
  );
}
