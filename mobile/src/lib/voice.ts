import { useCallback, useEffect, useRef, useState } from "react";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import * as Speech from "expo-speech";

export const stripMarkdown = (t: string) => t.replace(/```[\s\S]*?```/g, " code block ").replace(/[*#`_>~]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

/** Text to speech through the system voice (voice, rate and pitch are the phone's own settings). */
export function useSpeaker() {
  const [speaking, setSpeaking] = useState(false);
  const stop = useCallback(() => { void Speech.stop(); setSpeaking(false); }, []);
  const speak = useCallback((text: string) => {
    void Speech.stop(); setSpeaking(true);
    Speech.speak(stripMarkdown(text), { onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  }, []);
  useEffect(() => () => { void Speech.stop(); }, []);
  return { speaking, speak, stop };
}

export type DictationState = "idle" | "starting" | "listening";
/**
 * Dictation into the composer. Nothing is sent by voice: the transcript lands in the text box, you accept (✓) or throw it away (✕),
 * and you press send yourself. Same review step Claude and ChatGPT use on their phone apps.
 */
export function useDictation(opts: { onTranscript: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<DictationState>("idle"); const cancelled = useRef(false); const latest = useRef(opts);
  useEffect(() => { latest.current = opts; });
  useSpeechRecognitionEvent("start", () => setState("listening"));
  useSpeechRecognitionEvent("end", () => setState("idle"));
  useSpeechRecognitionEvent("result", (e) => { if (!cancelled.current) latest.current.onTranscript(e.results[0]?.transcript ?? ""); });
  useSpeechRecognitionEvent("error", (e) => {
    setState("idle");
    if (e.error === "aborted" || e.error === "no-speech") return;
    latest.current.onError(e.error === "not-allowed" ? "Microphone permission was denied. You can allow it in Android settings." : e.error === "service-not-allowed" ? "Speech recognition is turned off on this phone." : `Voice input error: ${e.message || e.error}`);
  });
  const start = useCallback(async () => {
    cancelled.current = false; setState("starting");
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) { setState("idle"); return latest.current.onError("Speech recognition isn't available on this phone. Type instead."); }
      const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!p.granted) { setState("idle"); return latest.current.onError("Microphone permission was denied. You can allow it in Android settings."); }
      ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: true, continuous: false, addsPunctuation: true });
    } catch (e) { setState("idle"); latest.current.onError(e instanceof Error ? e.message : "Couldn't start voice input."); }
  }, []);
  const accept = useCallback(() => { ExpoSpeechRecognitionModule.stop(); }, []);
  const cancel = useCallback(() => { cancelled.current = true; ExpoSpeechRecognitionModule.abort(); setState("idle"); }, []);
  return { state, listening: state !== "idle", start, accept, cancel };
}
