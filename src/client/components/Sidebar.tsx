import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../api.js";
import { Conversation } from "@shared/types.js";

interface Props {
  open: boolean;
  onClose: () => void;
  refreshKey: number;
}

export function Sidebar({ open, onClose, refreshKey }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const navigate = useNavigate();
  const { conversationId } = useParams();

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
  }, [refreshKey]);

  const handleNewChat = () => {
    navigate("/");
    onClose();
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.deleteConversation(id).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) navigate("/");
  };

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-header">
        <span className="brand">Vera</span>
      </div>
      <button className="new-chat-btn" onClick={handleNewChat}>
        + New chat
      </button>
      <div className="conversation-list">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`conversation-item ${conversationId === c.id ? "active" : ""}`}
            onClick={() => {
              navigate(`/c/${c.id}`);
              onClose();
            }}
          >
            <span>{c.title || "New conversation"}</span>
            <button className="delete-btn" onClick={(e) => handleDelete(e, c.id)} title="Delete">
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <Link to="/settings" onClick={onClose}>
          ⚙ Settings
        </Link>
      </div>
    </aside>
  );
}
