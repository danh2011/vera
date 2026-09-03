import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";

interface Props {
  onMenuClick: () => void;
}

const TITLES: Record<string, string> = {
  memories: "Memories",
  calendar: "Calendar",
  reminders: "Reminders",
  notes: "Notes",
  tasks: "Tasks",
  automations: "Automations",
};

function renderCard(kind: string, item: any) {
  switch (kind) {
    case "memories":
      return (
        <>
          <div className="title">{item.content}</div>
          <div className="meta">
            {item.category} · importance {item.importance}
          </div>
        </>
      );
    case "calendar":
      return (
        <>
          <div className="title">{item.title}</div>
          <div className="meta">{new Date(item.startsAt).toLocaleString()}</div>
        </>
      );
    case "reminders":
      return (
        <>
          <div className="title">{item.text}</div>
          <div className="meta">{new Date(item.dueAt).toLocaleString()}</div>
        </>
      );
    case "notes":
      return (
        <>
          <div className="title">{item.title}</div>
          <div className="meta">{item.content.slice(0, 80)}</div>
        </>
      );
    case "tasks":
      return (
        <>
          <div className="title">{item.title}</div>
          <div className="meta">
            {item.priority} priority{item.dueDate ? ` · due ${new Date(item.dueDate).toLocaleDateString()}` : ""}
          </div>
        </>
      );
    case "automations":
      return (
        <>
          <div className="title">{item.name}</div>
          <div className="meta">
            {item.cron} · {item.enabled ? "enabled" : "disabled"}
          </div>
        </>
      );
    default:
      return <div className="title">{JSON.stringify(item)}</div>;
  }
}

export function DataPage({ onMenuClick }: Props) {
  const { kind } = useParams<{ kind: string }>();
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!kind) return;
    api.getData(kind as any).then(setItems).catch(() => setItems([]));
  }, [kind]);

  return (
    <div className="main-panel">
      <div className="topbar">
        <button className="menu-btn" onClick={onMenuClick} aria-label="Menu">
          ☰
        </button>
        <span className="brand">{kind ? TITLES[kind] : ""}</span>
      </div>
      <div className="data-page">
        <h1>{kind ? TITLES[kind] : ""}</h1>
        <div className="card-list">
          {items.length === 0 && <p style={{ color: "var(--text-dim)" }}>Nothing here yet.</p>}
          {items.map((item) => (
            <div className="data-card" key={item.id}>
              {renderCard(kind ?? "", item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
