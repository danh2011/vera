import { Router } from "express";
import { runChatTurn } from "../ai/chatEngine.js";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const { conversationId, message } = req.body ?? {};
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const result = await runChatTurn({ conversationId: conversationId ?? null, userText: message });
    res.json(result);
  } catch (err) {
    console.error("[route:chat] error", err);
    res.status(500).json({ error: "Something went wrong processing your message." });
  }
});
