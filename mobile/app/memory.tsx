import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { Plus, Search, Trash2, X } from "lucide-react-native";
import type { MemoryCategory, MemoryItem } from "../src/api/types";
import { errMsg } from "../src/api/errors";
import { useApi } from "../src/state/app";
import { useToast } from "../src/state/toast";
import { fmtDate } from "../src/lib/dates";
import { haptic } from "../src/lib/haptics";
import { RADIUS, useTheme } from "../src/theme";
import { Button } from "../src/ui/Button";
import { Chip, Segmented, TextField } from "../src/ui/Field";
import { Badge, EmptyState, ErrorBox, Fab, Loading, Screen, ScreenHeader, useRefreshControl } from "../src/ui/Screen";
import { ConfirmDialog, Sheet } from "../src/ui/Sheet";
import { Text } from "../src/ui/Text";

type Tab = "memory" | "notes";
export default function MemoryScreen() {
  const api = useApi(); const toast = useToast(); const { c } = useTheme();
  const [tab, setTab] = useState<Tab>("memory"); const notes = tab === "notes"; const [items, setItems] = useState<MemoryItem[] | null>(null); const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [refreshing, setRefreshing] = useState(false);
  const [edit, setEdit] = useState<MemoryItem | "new" | null>(null); const [del, setDel] = useState<MemoryItem | null>(null);
  const load = useCallback(async () => { setErr(""); try { setItems(await (notes ? api.listNotes() : api.listMemories())); } catch (e) { setErr(errMsg(e)); } }, [api, notes]);
  useFocusEffect(useCallback(() => { setItems(null); void load(); }, [load]));
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "success"); await load(); } catch (e) { haptic.error(); toast(errMsg(e), "error"); } };
  const shown = useMemo(() => (items ?? []).filter((m) => `${m.title} ${m.content}`.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const refresh = useRefreshControl(refreshing, () => { setRefreshing(true); void load().finally(() => setRefreshing(false)); });

  const header = (
    <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 10 }}>
      <Segmented value={tab} onChange={(t) => { setTab(t); setQ(""); }} options={[{ value: "memory", label: "Memory" }, { value: "notes", label: "Notes" }]} />
      <Text variant="small" muted>{notes ? "Notes are longer pieces of text you or the assistant save. They stay in Vera's database and can be searched." : "Facts and preferences the assistant may use to personalise answers. It must ask your approval before saving one, and you can edit or delete anything here. Sensitive details are never sent to a cloud AI."}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: c.raised, borderRadius: RADIUS.pill }}>
        <Search size={16} color={c.muted} /><TextField value={q} onChangeText={setQ} placeholder={notes ? "Search notes" : "Search memory"} accessibilityLabel="Search" style={{ flex: 1 }} inputStyle={{ minHeight: 42, paddingVertical: 4, paddingHorizontal: 0 }} />
        {q ? <Pressable accessibilityLabel="Clear search" onPress={() => setQ("")} hitSlop={8}><X size={16} color={c.muted} /></Pressable> : null}
      </View>
    </View>
  );
  return (
    <Screen>
      <ScreenHeader title="Memory" />
      {err && !items ? <ErrorBox message={`Couldn't load this list. ${err}`} onRetry={() => void load()} /> : (
        <FlatList data={items ? shown : []} keyExtractor={(m) => m.id} refreshControl={refresh} ListHeaderComponent={header} contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={!items ? <Loading /> : <EmptyState title={items.length ? "No results" : notes ? "No notes yet" : "Nothing saved yet"} body={items.length ? undefined : "Tap Add, or ask Vera to remember something."} />}
          renderItem={({ item }) => <MemoryRow m={item} notes={notes} onEdit={() => setEdit(item)} onDelete={() => setDel(item)} />} />
      )}
      <Fab icon={Plus} label={notes ? "Add note" : "Add memory"} onPress={() => setEdit("new")} />
      <MemSheet key={edit === "new" ? `new-${tab}` : edit?.id ?? "none"} visible={!!edit} notes={notes} item={edit === "new" ? null : edit} onClose={() => setEdit(null)}
        onSave={(v) => { const t = edit; setEdit(null); void run(() => notes ? (t === "new" || !t ? api.createNote(v) : api.updateNote(t.id, v)) : (t === "new" || !t ? api.createMemory(v) : api.updateMemory(t.id, v)), notes ? "Note saved" : "Memory saved"); }} />
      <ConfirmDialog visible={!!del} title={notes ? "Delete note?" : "Delete memory?"} body={`"${del?.title}" will be removed.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => { const t = del; setDel(null); if (t) void run(() => (notes ? api.deleteNote(t.id) : api.deleteMemory(t.id)), notes ? "Note deleted" : "Memory deleted"); }} />
    </Screen>
  );
}

function MemoryRow({ m, notes, onEdit, onDelete }: { m: MemoryItem; notes: boolean; onEdit: () => void; onDelete: () => void }) {
  const { c } = useTheme(); const ref = useRef<SwipeableMethods>(null);
  return (
    <ReanimatedSwipeable ref={ref} friction={2} overshootRight={false} rightThreshold={64} renderRightActions={() => <View style={{ width: 88, backgroundColor: c.danger, alignItems: "center", justifyContent: "center" }}><Trash2 size={22} color={c.onDanger} /></View>} onSwipeableOpen={() => { ref.current?.close(); onDelete(); }}>
      <Pressable accessibilityRole="button" accessibilityHint="Opens for editing" onPress={onEdit} android_ripple={{ color: "rgba(127,127,127,0.15)" }} style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4, backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text weight="semibold" style={{ flexShrink: 1 }} numberOfLines={1}>{m.title}</Text>{!notes ? <Badge label={m.category} /> : null}{!notes && m.source === "assistant" ? <Badge label="saved by Vera" /> : null}</View>
        <Text numberOfLines={notes ? 4 : 3} muted style={{ fontSize: 15 }}>{m.content}</Text>
        <Text variant="tiny" muted>Updated {fmtDate(m.updatedAt)}</Text>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function MemSheet({ visible, notes, item, onSave, onClose }: { visible: boolean; notes: boolean; item: MemoryItem | null; onSave: (v: { title: string; content: string; category: MemoryCategory }) => void; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? ""); const [content, setContent] = useState(item?.content ?? ""); const [category, setCategory] = useState<MemoryCategory>(item?.category ?? "note"); const [err, setErr] = useState("");
  const submit = () => { if (!title.trim() || !content.trim()) return setErr("Title and content are required."); onSave({ title: title.trim(), content: content.trim(), category }); };
  return (
    <Sheet visible={visible} onClose={onClose} title={(item ? "Edit " : "New ") + (notes ? "note" : "memory")} tall footer={<View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Button label="Cancel" wide onPress={onClose} /></View><View style={{ flex: 1 }}><Button label="Save" kind="primary" wide onPress={submit} /></View></View>}>
      <View style={{ gap: 16, paddingTop: 8 }}>
        <TextField label="Title" value={title} onChangeText={setTitle} autoFocus={!item} />
        <TextField label="Content" value={content} onChangeText={(t) => { setContent(t); setErr(""); }} multiline inputStyle={{ minHeight: notes ? 200 : 110 }} error={err} />
        {!notes ? <View style={{ gap: 6 }}><Text variant="small" weight="medium">Type</Text><View style={{ flexDirection: "row", gap: 8 }}>{(["note", "fact", "preference"] as MemoryCategory[]).map((k) => <Chip key={k} label={k} on={category === k} onPress={() => setCategory(k)} />)}</View></View> : null}
      </View>
    </Sheet>
  );
}
