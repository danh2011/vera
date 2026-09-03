import ReactMarkdown from "react-markdown";
import { ChatMessage, CapabilityCallSummary } from "@shared/types.js";

interface Props {
  message: ChatMessage;
  blocked?: boolean;
  capabilityCalls?: CapabilityCallSummary[];
}

function CodeBlock({ children }: { children: string }) {
  const handleCopy = () => navigator.clipboard.writeText(children);
  return (
    <pre>
      <button className="copy-btn" onClick={handleCopy}>
        Copy
      </button>
      <code>{children}</code>
    </pre>
  );
}

export function MessageBubble({ message, blocked, capabilityCalls }: Props) {
  const isUser = message.role === "user";
  return (
    <>
      <div className={`message-row ${isUser ? "user" : "assistant"}`}>
        <div className={`message-bubble ${blocked ? "blocked" : ""}`}>
          {isUser ? (
            message.content
          ) : (
            <ReactMarkdown
              components={{
                code({ className, children }) {
                  const isBlock = className?.includes("language-");
                  if (isBlock) return <CodeBlock>{String(children).replace(/\n$/, "")}</CodeBlock>;
                  return <code>{children}</code>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      </div>
      {capabilityCalls && capabilityCalls.length > 0 && (
        <div className="capability-pill-row">
          {capabilityCalls.map((c, i) => (
            <span key={i} className={`capability-pill ${c.ok ? "ok" : "fail"}`}>
              {c.name}.{c.action.replace(`${c.name}_`, "")}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
