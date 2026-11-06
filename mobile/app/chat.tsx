import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Share, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ArrowDown, Copy, Share2, SquarePen, Text as TextIcon, Volume2 } from "lucide-react-native";
import type { Conversation, Message } from "../src/api/types";
import { errMsg } from "../src/api/errors";
import { useApi } from "../src/state/app";
import { notifyData } from "../src/state/drawer";
import { useRuns, type Run } from "../src/state/runs";
import { useSettings } from "../src/state/settings";
import { useToast } from "../src/state/toast";
import { useDictation, useSpeaker } from "../src/lib/voice";
import { haptic } from "../src/lib/haptics";
import { useTheme } from "../src/theme";
import { Button, IconButton } from "../src/ui/Button";
import { Screen, ScreenHeader } from "../src/ui/Screen";
import { ActionSheet, Sheet } from "../src/ui/Sheet";
import { Text } from "../src/ui/Text";
import { Composer, type Attachment } from "../src/features/chat/Composer";
import { Avatar, MessageItem, Thinking } from "../src/features/chat/Message";
import { ModelPicker } from "../src/features/chat/ModelPicker";

type Row = { kind: "msg"; m: Message; idx: number } | { kind: "run" } | { kind: "error"; msg: string; retry: () => void };
const PROMPTS = ["Help me organise my week.", "Check my home-server status.", "Find a note in my memory.", "Explain something I'm learning."];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>(); const router = useRouter(); const api = useApi(); const toast = useToast(); const { settings } = useSettings(); const { c, reduceMotion } = useTheme();
  const { runs, start, stop, clear, markSeen, setOpen } = useRuns(); const run: Run | undefined = id ? runs[id] : undefined; const busy = run?.status === "running";
  const [conv, setConv] = useState<Conversation | null>(null); const [draft, setDraft] = useState(""); const [file, setFile] = useState<Attachment | null>(null);
  const [fresh, setFresh] = useState<string | null>(null); const [openMap, setOpenMap] = useState<Record<string, boolean>>({}); const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<{ msg: string; retry: () => void } | null>(null); const [away, setAway] = useState(false); const [menu, setMenu] = useState<Message | null>(null); const [select, setSelect] = useState<Message | null>(null);
  const list = useRef<FlatList<Row>>(null); const baseDraft = useRef(""); const speaker = useSpeaker();
  const dictation = useDictation({ onTranscript: (t) => setDraft((baseDraft.current ? baseDraft.current.trimEnd() + " " : "") + t), onError: (m) => toast(m, "error") });

  useEffect(() => { setError(null); setFresh(null); if (!id) { setConv(null); return; } let live = true; api.getConversation(id).then((x) => live && setConv(x)).catch((e) => live && toast(errMsg(e), "error")); return () => { live = false; }; }, [id, api, toast]);
  useEffect(() => { if (id && run && run.status !== "running" && !run.seen) markSeen(id); }, [id, run, markSeen]);

  // When a reply finishes (even if we were on another screen) load it and keep the thinking line exactly as it was.
  const doneId = run?.status === "done" ? run.message?.id : undefined;
  useEffect(() => {
    if (!id || !run || run.status !== "done" || !run.message) return; let live = true; const r = run;
    api.getConversation(id).then((x) => {
      if (!live) return; setConv(x); const recent = Date.now() - (r.finishedAt ?? 0) < 4000;
      setOpenMap((m) => ({ ...m, [r.message!.id]: r.open })); setFresh(recent ? r.message!.id : null); markSeen(id); clear(id); notifyData();
      if (recent) haptic.success(); if (settings.speakReplies && recent) speaker.speak(r.message!.content);
    }).catch((e) => live && toast(errMsg(e), "error"));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneId, id]);

  const sendRef = useRef<(text: string, regenerate?: boolean) => Promise<void>>(async () => {});
  const send = useCallback(async (text: string, regenerate = false) => {
    const t = text.trim(); if (!t || busy) return;
    if (!regenerate) { setDraft(""); setFile(null); } setError(null);
    try {
      let cid = id; if (!cid) { cid = (await api.createConversation()).id; router.setParams({ id: cid }); }
      setAway(false); clear(cid); start(cid, t, regenerate);
    } catch (e) { setError({ msg: errMsg(e), retry: () => void sendRef.current(t, regenerate) }); }
  }, [api, busy, clear, id, router, start]);
  useEffect(() => { sendRef.current = send; });
  const resolve = async (m: Message, action: "approve" | "cancel") => {
    const cf = m.confirmation; if (!cf || !id) return; setResolving(true);
    try { const r = await api.resolveConfirmation(cf.id, cf.token, action); setFresh(r.id); setConv(await api.getConversation(id)); notifyData(); }
    catch (e) { toast(errMsg(e), "error"); setConv(await api.getConversation(id)); } finally { setResolving(false); }
  };
  const attach = async () => { try { const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: false, multiple: false }); const a = r.assets?.[0]; if (!r.canceled && a) setFile({ name: a.name, size: a.size ?? 0 }); } catch (e) { toast(errMsg(e), "error"); } };
  const mic = () => { if (dictation.listening) return dictation.accept(); baseDraft.current = draft; void dictation.start(); };

  const retryRun = (r: Run) => { const l = conv?.messages[conv.messages.length - 1]; const saved = l?.role === "user" && l.content.trim() === r.text.trim(); clear(r.cid); void send(r.text, saved); };
  // Rows are newest-first because the list is inverted: the latest message sits against the composer and the keyboard never hides it.
  const rows = useMemo<Row[]>(() => {
    let msgs = conv?.messages ?? [];
    if (run?.status === "running" && id) {
      if (run.regenerate) { msgs = [...msgs]; while (msgs.length && msgs[msgs.length - 1]!.role === "assistant") msgs.pop(); }
      else { const l = msgs[msgs.length - 1]; if (!(l?.role === "user" && (l.content.trim() === run.text.trim() || new Date(l.createdAt).getTime() >= run.startedAt - 5000))) msgs = [...msgs, { id: `tmp-${run.startedAt}`, conversationId: id, role: "user", content: run.text, createdAt: new Date(run.startedAt).toISOString() }]; }
    }
    const out: Row[] = [];
    const shownError = error ?? (run?.status === "error" ? { msg: run.error ?? "Something went wrong.", retry: () => retryRun(run) } : null);
    if (shownError) out.push({ kind: "error", ...shownError });
    if (busy) out.push({ kind: "run" });
    for (let i = msgs.length - 1; i >= 0; i--) out.push({ kind: "msg", m: msgs[i]!, idx: i });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, run, error, busy, id]);
  const lastIdx = (conv?.messages.length ?? 0) - 1; const lastUser = [...(conv?.messages ?? [])].reverse().find((m) => m.role === "user");
  const empty = rows.length === 0;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setAway(e.nativeEvent.contentOffset.y > 240);
  const name = settings.name; const interest = settings.interests[0];
  const prompts = interest ? [...PROMPTS.slice(0, 3), `Tell me something interesting about ${interest.toLowerCase()}.`] : PROMPTS;

  return (
    <Screen>
      <ScreenHeader center={<ModelPicker />} right={<IconButton icon={SquarePen} label="New chat" color={c.text} onPress={() => { setDraft(""); router.setParams({ id: "" }); }} />} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {empty ? (
          <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 22, paddingBottom: 12 }}>
            <Animated.View entering={reduceMotion ? undefined : FadeInUp.duration(380)} style={{ gap: 8 }}>
              <Text variant="h1" style={{ textAlign: "center", fontSize: 30, lineHeight: 37 }}>{name ? `Hello, ${name}. What can I help you with?` : "Hello, I'm Vera. What can I help you with?"}</Text>
              <Text muted style={{ textAlign: "center", marginBottom: 14 }}>Ask for the time, a sum or your tasks and Vera answers on your server. Other questions use the AI provider if you have enabled one.</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>{prompts.map((t) => <Button key={t} label={t} small onPress={() => void send(t)} style={{ maxWidth: "100%" }} />)}</View>
            </Animated.View>
          </View>
        ) : (
          <FlatList ref={list} inverted data={rows} keyExtractor={(r) => (r.kind === "msg" ? r.m.id : r.kind)} onScroll={onScroll} scrollEventThrottle={64} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingVertical: 8 }} removeClippedSubviews={false} initialNumToRender={12} maxToRenderPerBatch={8} windowSize={9}
            renderItem={({ item }) => {
              if (item.kind === "run") return <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}><Avatar working /><View style={{ flex: 1 }}><Thinking steps={run?.steps ?? []} running startedAt={run?.startedAt} open={!!run?.open} onToggle={() => id && setOpen(id, !run?.open)} /></View></View>;
              if (item.kind === "error") return <View accessibilityRole="alert" style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}><Avatar error /><View style={{ flex: 1, gap: 8 }}><Text color={c.danger}>{item.msg}</Text><Button label="Retry" small onPress={item.retry} /></View></View>;
              const m = item.m;
              return <MessageItem m={m} isLast={item.idx === lastIdx} canRegenerate={!!lastUser && !busy} fresh={fresh === m.id && !reduceMotion} open={!!openMap[m.id]} resolving={resolving}
                onToggleSteps={() => setOpenMap((o) => ({ ...o, [m.id]: !o[m.id] }))} onRegenerate={() => lastUser && void send(lastUser.content, true)} onResolve={(a) => void resolve(m, a)} onSpeak={() => speaker.speak(m.content)} onUseText={setDraft} onMenu={() => setMenu(m)} />;
            }} />
        )}
        {away ? <View pointerEvents="box-none" style={{ position: "absolute", bottom: 110, alignSelf: "center" }}><IconButton icon={ArrowDown} label="Scroll to latest" onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} style={{ backgroundColor: c.raised, borderWidth: 1, borderColor: c.border, elevation: 4 }} color={c.text} /></View> : null}
        <Composer value={draft} onChange={setDraft} onSend={() => void send(draft)} onStop={() => id && stop(id)} busy={busy} attachment={file} onAttachPress={() => void attach()} onClearAttachment={() => setFile(null)}
          listening={dictation.listening} onMic={mic} onAcceptVoice={dictation.accept} onCancelVoice={() => { dictation.cancel(); setDraft(baseDraft.current); }} speaking={speaker.speaking} onStopSpeaking={speaker.stop} enterToSend={settings.enterToSend}
          footnote="Vera can make mistakes. Banking details, passwords and keys are never sent to the AI." />
      </KeyboardAvoidingView>

      <ActionSheet visible={!!menu} onClose={() => setMenu(null)} actions={menu ? [
        { label: "Copy", icon: Copy, onPress: () => { void Clipboard.setStringAsync(menu.content); toast("Copied", "success"); } },
        { label: "Select text", icon: TextIcon, onPress: () => setSelect(menu) },
        ...(menu.role === "assistant" ? [{ label: "Read aloud", icon: Volume2, onPress: () => speaker.speak(menu.content) }] : []),
        { label: "Share", icon: Share2, onPress: () => void Share.share({ message: menu.content }) },
      ] : []} />
      <Sheet visible={!!select} onClose={() => setSelect(null)} title="Select text" tall>
        <Text selectable style={{ paddingBottom: 12 }}>{select?.content}</Text>
      </Sheet>
    </Screen>
  );
}
