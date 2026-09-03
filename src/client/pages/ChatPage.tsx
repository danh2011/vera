import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { ChatMessage, CapabilityCallSummary, DevInfo } from "@shared/types.js";
import { MessageBubble } from "../components/MessageBubble.js";
import { Composer } from "../components/Composer.js";

interface Props {
  onMenuClick: () => void;
  onConversationChange: () => void;
}

const SUGGESTIONS = [
  "What's on my calendar tomorrow?",
  "Remember that I prefer AMD CPUs.",
  "What's the weather like?",
  "Set a 10 minute timer.",
];

export function ChatPage({ onMenuClick, onConversationChange }: Props) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingCalls, setPendingCalls] = useState<Record<string, CapabilityCallSummary[]>>({});
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [devInfo, setDevInfo] = useState<DevInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (conversationId) {
      api
        .getMessages(conversationId)
        .then((msgs) => {
          if (!cancelled) setMessages(msgs);
        })
        .catch(() => {
          if (!cancelled) setMessages([]);
        });
    } else {
      setMessages([]);
    }
    setDevInfo(null);
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const handleSend = async (text: string) => {
    const optimisticUser: ChatMessage = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? "",
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setSending(true);
    try {
      const result = await api.sendMessage(conversationId ?? null, text);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimisticUser.id), { ...optimisticUser, conversationId: result.conversationId }, result.message]);
      if (result.capabilityCalls.length > 0) {
        setPendingCalls((prev) => ({ ...prev, [result.message.id]: result.capabilityCalls }));
      }
      if (result.blocked) {
        setBlockedIds((prev) => new Set(prev).add(result.message.id));
      }
      if (result.devInfo) setDevInfo(result.devInfo);
      if (!conversationId) {
        navigate(`/c/${result.conversationId}`);
      }
      onConversationChange();
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          conversationId: conversationId ?? "",
          role: "assistant",
          content: "Something went wrong sending that message. Please try again.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="main-panel">
      <div className="topbar">
        <button className="menu-btn" onClick={onMenuClick} aria-label="Menu">
          ☰
        </button>
        <span className="brand">Vera</span>
      </div>

      {messages.length === 0 ? (
        <div className="empty-state">
          <h1>Good to see you.</h1>
          <p>What can I help you with?</p>
          <div className="suggestion-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion-chip" onClick={() => handleSend(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-scroll" ref={scrollRef}>
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              blocked={blockedIds.has(m.id)}
              capabilityCalls={pendingCalls[m.id]}
            />
          ))}
          {sending && (
            <div className="message-row assistant">
              <div className="message-bubble">
                <div className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
          {devInfo && (
            <div className="dev-panel">
              model: {devInfo.model} · {devInfo.responseTimeMs}ms · ~{devInfo.contextApproxTokens} tokens ·{" "}
              {devInfo.contextMessageCount} msgs in context
              {devInfo.capabilitiesConsidered.length > 0 && (
                <> · capabilities: {devInfo.capabilitiesConsidered.join(", ")}</>
              )}
            </div>
          )}
        </div>
      )}

      <Composer onSend={handleSend} disabled={sending} />
    </div>
  );
}
