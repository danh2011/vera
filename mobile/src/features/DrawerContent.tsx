import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, View } from "react-native";
import { usePathname, useRouter, useGlobalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Blocks, Brain, CheckSquare, MoreHorizontal, Pencil, Search, Server, Settings as Cog, SquarePen, Trash2, LogOut } from "lucide-react-native";
import type { ConversationSummary } from "../api/types";
import { errMsg } from "../api/errors";
import { useApi, useSession } from "../state/app";
import { onData, notifyData } from "../state/drawer";
import { useRuns } from "../state/runs";
import { useToast } from "../state/toast";
import { GROUPS, groupOf, type Group } from "../lib/dates";
import { FONT, RADIUS, useTheme } from "../theme";
import { ActionSheet, ConfirmDialog, Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Logo } from "../ui/Logo";
import { Text } from "../ui/Text";

const NAV = [{ to: "/tasks", label: "Tasks", icon: CheckSquare }, { to: "/memory", label: "Memory", icon: Brain }, { to: "/integrations", label: "Integrations", icon: Blocks }, { to: "/systems", label: "Systems", icon: Server }] as const;

/** The web sidebar, as a phone drawer: new chat, sections, searchable history grouped by recency, account. */
export function DrawerContent({ close }: { close: () => void }) {
  const { c } = useTheme(); const insets = useSafeAreaInsets(); const api = useApi(); const { username, signOut } = useSession(); const toast = useToast(); const router = useRouter();
  const path = usePathname(); const { id: activeId } = useGlobalSearchParams<{ id?: string }>(); const { runs } = useRuns();
  const [list, setList] = useState<ConversationSummary[]>([]); const [q, setQ] = useState(""); const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<ConversationSummary | null>(null); const [del, setDel] = useState<ConversationSummary | null>(null); const [ren, setRen] = useState<{ c: ConversationSummary; v: string } | null>(null);
  const refresh = useCallback(() => { api.listConversations().then((l) => { setList(l); setLoading(false); }).catch((e) => { setLoading(false); toast(errMsg(e), "error"); }); }, [api, toast]);
  useEffect(() => { refresh(); return onData(refresh); }, [refresh]);

  const sections = useMemo(() => {
    const shown = list.filter((x) => x.title.toLowerCase().includes(q.toLowerCase()));
    return GROUPS.map((g: Group) => ({ title: g, data: shown.filter((x) => groupOf(x.updatedAt) === g) })).filter((s) => s.data.length);
  }, [list, q]);
  const go = (to: string) => { close(); router.navigate(to as never); };
  const openChat = (id?: string) => { close(); router.navigate((id ? { pathname: "/chat", params: { id } } : { pathname: "/chat", params: {} }) as never); };
  const commitRename = async () => { const r = ren; setRen(null); if (!r || !r.v.trim()) return; try { await api.renameConversation(r.c.id, r.v.trim()); refresh(); } catch (e) { toast(errMsg(e), "error"); } };
  const onChat = path.startsWith("/chat");

  return (
    <View style={{ flex: 1, backgroundColor: c.side, paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 8) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 10 }}><Logo size={26} /><Text variant="title" style={{ fontSize: 18 }}>Vera</Text></View>
      <View style={{ paddingHorizontal: 8, gap: 2 }}>
        <Row icon={SquarePen} label="New chat" strong onPress={() => openChat()} />
        {NAV.map((n) => <Row key={n.to} icon={n.icon} label={n.label} active={path.startsWith(n.to)} onPress={() => go(n.to)} />)}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 10, marginBottom: 2, paddingHorizontal: 12, backgroundColor: c.raised, borderRadius: RADIUS.pill }}>
        <Search size={16} color={c.muted} /><TextField value={q} onChangeText={setQ} placeholder="Search chats" accessibilityLabel="Search conversations" style={{ flex: 1 }} inputStyle={{ paddingVertical: 4, minHeight: 40, paddingHorizontal: 0 }} />
      </View>
      <SectionList
        style={{ flex: 1 }} sections={sections} keyExtractor={(x) => x.id} keyboardShouldPersistTaps="handled" stickySectionHeadersEnabled={false}
        ListEmptyComponent={loading ? <View style={{ padding: 24 }}><ActivityIndicator color={c.muted} /></View> : <Text variant="small" muted style={{ padding: 18 }}>{q ? "No matching chats" : "No conversations yet"}</Text>}
        renderSectionHeader={({ section }) => <Text variant="tiny" muted weight="medium" style={{ marginHorizontal: 18, marginTop: 14, marginBottom: 4 }}>{section.title}</Text>}
        renderItem={({ item }) => {
          const run = runs[item.id]; const active = onChat && activeId === item.id;
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => openChat(item.id)} onLongPress={() => setMenu(item)} android_ripple={{ color: "rgba(127,127,127,0.2)" }}
              style={{ flexDirection: "row", alignItems: "center", marginHorizontal: 8, minHeight: 46, paddingLeft: 12, borderRadius: RADIUS.md, backgroundColor: active ? c.hover : "transparent" }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 15.5 }}>{item.title}</Text>
              {run?.status === "running" ? <ActivityIndicator size="small" color={c.accent} accessibilityLabel="Vera is replying in this chat" style={{ marginRight: 6 }} /> : run && !run.seen && !active ? <View accessibilityLabel="New reply" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent, marginRight: 8 }} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${item.title}`} hitSlop={4} onPress={() => setMenu(item)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><MoreHorizontal size={18} color={c.muted} /></Pressable>
            </Pressable>);
        }}
      />
      <View style={{ paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6, gap: 2 }}>
        <Row icon={Cog} label="Settings" active={path.startsWith("/settings")} onPress={() => go("/settings")} />
        {username ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Sign out ${username}`} onPress={() => { close(); void signOut(); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}><Text style={{ color: c.onAccent, fontFamily: FONT.bold, fontSize: 13 }}>{username[0]?.toUpperCase()}</Text></View>
            <Text style={{ flex: 1 }} numberOfLines={1}>{username}</Text><LogOut size={16} color={c.muted} /><Text variant="small" muted>Sign out</Text>
          </Pressable>) : null}
      </View>

      <ActionSheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.title} actions={menu ? [
        { label: "Rename", icon: Pencil, onPress: () => setRen({ c: menu, v: menu.title }) },
        { label: "Delete", icon: Trash2, danger: true, onPress: () => setDel(menu) }] : []} />
      <Sheet visible={!!ren} onClose={() => setRen(null)} title="Rename chat" scroll={false}
        footer={<View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Button label="Cancel" wide onPress={() => setRen(null)} /></View><View style={{ flex: 1 }}><Button label="Save" kind="primary" wide disabled={!ren?.v.trim()} onPress={() => void commitRename()} /></View></View>}>
        <TextField label="Title" value={ren?.v ?? ""} onChangeText={(v) => setRen((r) => (r ? { ...r, v } : r))} maxLength={120} autoFocus selectTextOnFocus onSubmitEditing={() => void commitRename()} />
      </Sheet>
      <ConfirmDialog visible={!!del} title="Delete chat?" body={`This will delete "${del?.title}" and its messages from the server.`} confirmLabel="Delete" onCancel={() => setDel(null)}
        onConfirm={async () => { const d = del; setDel(null); if (!d) return; try { await api.deleteConversation(d.id); toast("Chat deleted", "success"); if (activeId === d.id) router.replace({ pathname: "/chat", params: {} } as never); notifyData(); } catch (e) { toast(errMsg(e), "error"); } }} />
    </View>
  );
}

function Row({ icon: Icon, label, onPress, active, strong }: { icon: typeof Cog; label: string; onPress: () => void; active?: boolean; strong?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} onPress={onPress} android_ripple={{ color: "rgba(127,127,127,0.2)" }}
      style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 48, paddingHorizontal: 12, borderRadius: RADIUS.md, backgroundColor: active ? c.hover : "transparent" }}>
      <Icon size={19} color={c.text} /><Text style={{ fontFamily: strong ? FONT.semibold : FONT.medium, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}
