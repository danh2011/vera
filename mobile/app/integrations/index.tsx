import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, SectionList, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Search, X } from "lucide-react-native";
import type { IntegrationSummary, IntegrationsCatalogue } from "../../../shared/types";
import { errMsg } from "../../src/api/errors";
import { useApi } from "../../src/state/app";
import { useToast } from "../../src/state/toast";
import { RADIUS, useTheme } from "../../src/theme";
import { Button } from "../../src/ui/Button";
import { Chip, TextField } from "../../src/ui/Field";
import { EmptyState, ErrorBox, Screen, ScreenHeader, Skeleton, useRefreshControl } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { IntIcon, StatusBadge, Tag, Where } from "../../src/features/integrations/parts";
import { ACTION_LABEL, FILTERS, OPEN_ROUTE, filterCounts, filterIntegrations, needsWizard, type Filter } from "../../src/features/integrations/util";

export default function IntegrationsScreen() {
  const api = useApi(); const toast = useToast(); const router = useRouter(); const { c } = useTheme();
  const [cat, setCat] = useState<IntegrationsCatalogue | null>(null); const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [filter, setFilter] = useState<Filter>("all"); const [category, setCategory] = useState("all"); const [busy, setBusy] = useState<string | null>(null); const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { setErr(""); try { setCat(await api.integrations.catalogue()); } catch (e) { setErr(errMsg(e)); } }, [api]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const labels = useMemo(() => Object.fromEntries((cat?.categories ?? []).map((x) => [x.id, x.label])), [cat]);
  const list = useMemo(() => cat?.integrations ?? [], [cat]); const counts = useMemo(() => filterCounts(list), [list]);
  const shown = useMemo(() => filterIntegrations(list, { q, filter, category, categoryLabels: labels }), [list, q, filter, category, labels]);
  const filtering = q.trim() !== "" || filter !== "all" || category !== "all";
  const refresh = useRefreshControl(refreshing, () => { setRefreshing(true); void load().finally(() => setRefreshing(false)); });

  const open = (id: string) => router.push(`/integrations/${id}` as never);
  const act = async (s: IntegrationSummary) => {
    if (s.nextAction === "configure" || s.nextAction === "connect") return router.push({ pathname: "/integrations/setup/[id]", params: { id: s.id, step: s.status === "needs_dependency" ? "deps" : s.nextAction === "connect" ? "oauth" : "" } } as never);
    if (s.nextAction === "open") { const r = OPEN_ROUTE[s.id]; if (r) return router.navigate(r as never); toast(`Ask Vera in chat to use ${s.name}.`, "info"); return router.navigate("/chat" as never); }
    setBusy(s.id);
    try {
      if (s.nextAction === "install") { await api.integrations.install(s.id); const d = await api.integrations.detail(s.id); if (needsWizard(d)) { toast(`${s.name} installed. Let's set it up.`, "success"); router.push({ pathname: "/integrations/setup/[id]", params: { id: s.id, step: d.dependencies.some((x) => !x.satisfied) ? "deps" : "" } } as never); } else toast(`${s.name} installed and ready.`, "success"); }
      else if (s.nextAction === "enable") { await api.integrations.enable(s.id); toast(`${s.name} is on`, "success"); }
      await load();
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(null); }
  };

  const attention = shown.filter((s) => s.attention); const installed = shown.filter((s) => s.installed && !s.attention); const available = shown.filter((s) => !s.installed);
  const oneClick = available.filter((s) => s.runsLocally && !s.requiresCredentials && !s.contactsExternalServices && s.status !== "unavailable");
  const sections = filtering ? [{ title: `${shown.length} result${shown.length === 1 ? "" : "s"}`, hint: "", data: shown }]
    : [{ title: "Needs attention", hint: "These are installed but not working yet.", data: attention }, { title: "Ready in one click", hint: "Works on this server, needs no account or setup.", data: oneClick }, { title: "Installed", hint: "", data: installed }, { title: "Available", hint: "", data: available.filter((s) => !oneClick.includes(s)) }].filter((s) => s.data.length);

  const header = (
    <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 4 }}>
      <Text variant="small" muted>Add abilities to Vera. Install in one tap, follow the short setup if one is needed, then ask Vera in chat. Everything here is reviewed and bundled with Vera: nothing is downloaded when you install.</Text>
      {cat ? <Text variant="small" accessibilityRole="summary" muted>{cat.counts.installed} installed · {cat.counts.enabled} enabled · <Text variant="small" color={cat.counts.needsAttention ? c.warn : c.muted}>{cat.counts.needsAttention} need attention</Text> · {cat.counts.total} available</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: c.raised, borderRadius: RADIUS.pill }}>
        <Search size={16} color={c.muted} /><TextField value={q} onChangeText={setQ} placeholder="Search integrations" accessibilityLabel="Search integrations" style={{ flex: 1 }} inputStyle={{ minHeight: 44, paddingVertical: 4, paddingHorizontal: 0 }} />
        {q ? <Pressable accessibilityLabel="Clear search" onPress={() => setQ("")} hitSlop={8}><X size={16} color={c.muted} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{FILTERS.map((f) => <Chip key={f.id} label={f.label} count={counts[f.id]} on={filter === f.id} onPress={() => setFilter(f.id)} />)}</ScrollView>
      {cat ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}><Chip label="All categories" on={category === "all"} onPress={() => setCategory("all")} />{cat.categories.map((x) => <Chip key={x.id} label={x.label} count={x.count} on={category === x.id} onPress={() => setCategory(x.id)} />)}</ScrollView> : null}
    </View>
  );
  return (
    <Screen>
      <ScreenHeader title="Integrations" />
      {err && !cat ? <ErrorBox message={`Couldn't load integrations. ${err}`} onRetry={() => void load()} /> : (
        <SectionList sections={sections} keyExtractor={(s) => s.id} refreshControl={refresh} ListHeaderComponent={header} stickySectionHeadersEnabled={false} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={!cat ? <View style={{ padding: 16, gap: 12 }}>{[0, 1, 2].map((k) => <Skeleton key={k} height={120} style={{ borderRadius: 16 }} />)}</View> : <EmptyState title={filtering ? "No integrations match" : "No integrations are bundled with this build"} action={filtering ? <Button label="Clear search and filters" onPress={() => { setQ(""); setFilter("all"); setCategory("all"); }} /> : undefined} />}
          renderSectionHeader={({ section }) => <View style={{ paddingHorizontal: 16, marginTop: 20, marginBottom: 8 }}><Text variant="h3" accessibilityRole="header">{section.title}{filtering ? "" : <Text variant="small" muted>  {section.data.length}</Text>}</Text>{section.hint ? <Text variant="small" muted>{section.hint}</Text> : null}</View>}
          renderItem={({ item }) => <Card2 s={item} busy={busy === item.id} onOpen={() => open(item.id)} onAction={() => void act(item)} />} />
      )}
    </Screen>
  );
}

function Card2({ s, busy, onOpen, onAction }: { s: IntegrationSummary; busy: boolean; onOpen: () => void; onAction: () => void }) {
  const { c } = useTheme(); const label = busy ? "Working…" : s.nextAction === "open" && !OPEN_ROUTE[s.id] ? "Use in chat" : ACTION_LABEL[s.nextAction];
  return (
    <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: RADIUS.lg, padding: 14, gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${s.name}: ${s.statusLabel}. Open details`} onPress={onOpen} style={{ flexDirection: "row", gap: 12 }}>
        <IntIcon name={s.icon} />
        <View style={{ flex: 1, gap: 2 }}><Text weight="semibold">{s.name}</Text><Text variant="small" muted numberOfLines={3}>{s.description}</Text></View>
      </Pressable>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}><StatusBadge s={s} /><Where s={s} />{s.dependencies.map((d) => <Tag key={d.id} label={`Needs ${d.name}`} ok={d.satisfied} />)}</View>
      {s.statusDetail && s.attention ? <Text variant="small" color={c.warn}>{s.statusDetail}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text variant="small" muted style={{ flex: 1 }}>{s.installed ? `${s.toolsAvailable} of ${s.toolCount} tools ready` : `${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`}</Text>
        {s.nextAction !== "none" ? <Button label={label} small kind={s.nextAction === "install" || s.attention ? "primary" : "default"} disabled={busy} loading={busy} onPress={onAction} accessibilityLabel={`${label} ${s.name}`} /> : null}
      </View>
    </View>
  );
}
