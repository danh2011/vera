import { useRef, useState, KeyboardEvent } from "react";
import { isModifierEnter } from "../keyboard.js";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function Composer({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (no modifiers) or Cmd+Enter
    if ((e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) || isModifierEnter(e)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div className="composer-area">
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask Vera... (Enter to send, Shift+Enter for new line)"
          rows={1}
          autoFocus
          title="Type your message here. Press Enter to send, Shift+Enter for a new line, Cmd/Ctrl+Enter as alternative send."
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send message (Enter)"
          title="Send message (Enter or Cmd+Enter)"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
