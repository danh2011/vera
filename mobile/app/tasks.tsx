import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { Bell, Check, Plus, Search, Trash2, X } from "lucide-react-native";
import type { ReminderChannel, ReminderDto } from "../../shared/types";
import type { Priority, Task } from "../src/api/types";
import { errMsg } from "../src/api/errors";
import { useApi } from "../src/state/app";
import { useToast } from "../src/state/toast";
import { fmtDateTime, isOverdue } from "../src/lib/dates";
import { haptic } from "../src/lib/haptics";
import { RADIUS, useTheme } from "../src/theme";
import { Button, IconButton } from "../src/ui/Button";
import { Checkbox, Chip, Segmented, TextField } from "../src/ui/Field";
import { Badge, EmptyState, ErrorBox, Fab, Loading, Screen, ScreenHeader, SectionTitle, useRefreshControl } from "../src/ui/Screen";
import { ConfirmDialog, Sheet } from "../src/ui/Sheet";
import { Text } from "../src/ui/Text";
import { DateField } from "../src/features/DateField";

type Filter = "all" | "open" | "completed" | "overdue";
const FILTERS: Filter[] = ["all", "open", "completed", "overdue"];
const REMIND = [{ v: "none", l: "No reminder" }, { v: "0", l: "At due time" }, { v: "15", l: "15 min before" }, { v: "60", l: "1 hour before" }, { v: "1440", l: "1 day before" }];

export default function TasksScreen() {
  const api = useApi(); const toast = useToast(); const router = useRouter(); const { c } = useTheme();
  const [tasks, setTasks] = useState<Task[] | null>(null); const [reminders, setReminders] = useState<ReminderDto[]>([]); const [channel, setChannel] = useState<ReminderChannel | null>(null);
  const [err, setErr] = useState(""); const [refreshing, setRefreshing] = useState(false); const [filter, setFilter] = useState<Filter>("all"); const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Task | "new" | null>(null); const [del, setDel] = useState<Task | null>(null); const [setting, setSetting] = useState(false);
  const load = useCallback(async () => {
    setErr("");
    try { const [t, r] = await Promise.all([api.listTasks(), api.listReminders().catch(() => null)]); setTasks(t); if (r) { setReminders(r.reminders); setChannel(r.channel); } } catch (e) { setErr(errMsg(e)); }
  }, [api]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "success"); await load(); } catch (e) { haptic.error(); toast(errMsg(e), "error"); } };
  const shown = useMemo(() => (tasks ?? []).filter((t) => t.title.toLowerCase().includes(q.toLowerCase()) && (filter === "all" || (filter === "open" && !t.completed) || (filter === "completed" && t.completed) || (filter === "overdue" && isOverdue(t)))).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")), [tasks, q, filter]);
  const refresh = useRefreshControl(refreshing, () => { setRefreshing(true); void load().finally(() => setRefreshing(false)); });
  const setupReminders = async () => {
    if (!channel) return; setSetting(true);
    try { if (!channel.installed) await api.integrations.install(channel.integrationId); router.push(`/integrations/setup/${channel.integrationId}` as never); } catch (e) { toast(errMsg(e), "error"); } finally { setSetting(false); }
  };

  const header = (
    <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
      {channel && !channel.ready ? (
        <View accessibilityRole="summary" style={{ flexDirection: "row", gap: 12, backgroundColor: c.surface, borderRadius: RADIUS.lg, borderLeftWidth: 3, borderLeftColor: c.warn, padding: 14 }}>
          <Bell size={17} color={c.warn} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 8 }}><Text weight="semibold">Reminders can't alert you yet</Text><Text variant="small" muted>{channel.detail} Reminders you set now are kept and sent once Notifications is working (up to a day late).</Text>
            <Button label={channel.installed ? "Finish setting up reminders" : "Set up reminders"} kind="primary" small loading={setting} onPress={() => void setupReminders()} /></View>
        </View>) : channel?.ready ? <Text variant="small" muted><Bell size={12} color={c.muted} /> Reminders are delivered through Home Assistant.</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: c.raised, borderRadius: RADIUS.pill }}>
        <Search size={16} color={c.muted} /><TextField value={q} onChangeText={setQ} placeholder="Search tasks" accessibilityLabel="Search tasks" style={{ flex: 1 }} inputStyle={{ minHeight: 42, paddingVertical: 4, paddingHorizontal: 0 }} />
        {q ? <Pressable accessibilityLabel="Clear search" onPress={() => setQ("")} hitSlop={8}><X size={16} color={c.muted} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{FILTERS.map((f) => <Chip key={f} label={f[0]!.toUpperCase() + f.slice(1)} on={filter === f} onPress={() => setFilter(f)} />)}</ScrollView>
    </View>
  );

  return (
    <Screen>
      <ScreenHeader title="Tasks" subtitle="Swipe right to complete, left to delete" />
      {err && !tasks ? <ErrorBox message={`Couldn't load tasks. ${err}`} onRetry={() => void load()} /> : !tasks ? <Loading /> : (
        <FlatList data={shown} keyExtractor={(t) => t.id} refreshControl={refresh} ListHeaderComponent={header} contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState title={tasks.length ? "No tasks match this filter" : "No tasks yet"} body={tasks.length ? undefined : "Add your first one, or ask Vera in chat."} />}
          renderItem={({ item }) => <TaskRow t={item} onToggle={() => void run(() => api.updateTask(item.id, { completed: !item.completed }), item.completed ? "Task reopened" : "Task completed")} onEdit={() => setEdit(item)} onDelete={() => setDel(item)} />}
          ListFooterComponent={reminders.length ? (
            <View style={{ paddingHorizontal: 16 }}><SectionTitle count={reminders.length}>Reminders</SectionTitle>
              {reminders.map((r) => { const late = r.status === "scheduled" && new Date(r.remindAt).getTime() < Date.now(); const tone = r.status === "failed" || r.status === "missed" ? "danger" : late ? "warn" : "muted";
                return (
                  <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingVertical: 6 }}>
                    <Bell size={16} color={c.muted} />
                    <View style={{ flex: 1, gap: 2 }}><Text numberOfLines={2}>{r.title}</Text><View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Text variant="tiny" muted>{fmtDateTime(r.remindAt)}</Text>
                      <Badge tone={tone} label={r.status === "scheduled" ? (late ? (r.attempts ? "Retrying" : "Waiting for Notifications") : "Scheduled") : r.status === "sent" ? "Sent" : r.status === "failed" ? "Failed" : "Missed"} /></View>
                      {r.deliveryDetail && (r.status !== "scheduled" || late) ? <Text variant="tiny" muted>{r.deliveryDetail}</Text> : null}</View>
                    {r.status === "scheduled" ? <IconButton icon={X} label={`Cancel reminder ${r.title}`} size={18} onPress={() => void run(() => api.cancelReminder(r.id), "Reminder cancelled")} /> : null}
                  </View>); })}
            </View>) : undefined} />
      )}
      <Fab icon={Plus} label="Add task" onPress={() => setEdit("new")} />
      <TaskSheet key={edit === "new" ? "new" : edit?.id ?? "none"} visible={!!edit} task={edit === "new" ? null : edit} channelReady={!!channel?.ready} onClose={() => setEdit(null)}
        onSave={(v, remindMin) => { const t = edit; setEdit(null); void run(async () => { const saved = t === "new" || !t ? await api.createTask(v) : await api.updateTask(t.id, v); if (remindMin !== null && saved.dueAt) await api.createReminder({ title: saved.title, remindAt: new Date(new Date(saved.dueAt).getTime() - remindMin * 60000).toISOString(), taskId: saved.id }); }, remindMin !== null ? "Task and reminder saved" : "Task saved"); }} />
      <ConfirmDialog visible={!!del} title="Delete task?" body={`"${del?.title}" will be removed.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => { const t = del; setDel(null); if (t) void run(() => api.deleteTask(t.id), "Task deleted"); }} />
    </Screen>
  );
}

function TaskRow({ t, onToggle, onEdit, onDelete }: { t: Task; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const { c } = useTheme(); const ref = useRef<SwipeableMethods>(null); const late = isOverdue(t);
  return (
    <ReanimatedSwipeable ref={ref} friction={2} overshootLeft={false} overshootRight={false} leftThreshold={64} rightThreshold={64}
      renderLeftActions={() => <Action bg={c.ok}><Check size={22} color="#0b0b0f" /></Action>} renderRightActions={() => <Action bg={c.danger}><Trash2 size={22} color={c.onDanger} /></Action>}
      onSwipeableOpen={(dir) => { ref.current?.close(); /* "left" = the left-hand (complete) actions were revealed */ if (dir === "left") onToggle(); else onDelete(); }}>
      <Pressable accessibilityRole="button" accessibilityHint="Opens the task for editing" onPress={onEdit} android_ripple={{ color: "rgba(127,127,127,0.15)" }}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 68, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.bg, borderLeftWidth: 3, borderLeftColor: late ? c.danger : "transparent" }}>
        <Checkbox checked={t.completed} label={`Mark "${t.title}" ${t.completed ? "open" : "complete"}`} onPress={onToggle} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={2} style={t.completed ? { textDecorationLine: "line-through", color: c.muted } : undefined}>{t.title}</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Text variant="tiny" muted>{t.dueAt ? fmtDateTime(t.dueAt) : "No due date"}</Text>
            {late ? <Badge tone="danger" label="Overdue" /> : null}{t.priority !== "medium" ? <Badge tone={t.priority === "high" ? "warn" : "muted"} label={t.priority} /> : null}
          </View>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function TaskSheet({ visible, task, channelReady, onSave, onClose }: { visible: boolean; task: Task | null; channelReady: boolean; onSave: (v: { title: string; dueAt?: string; priority: Priority }, remindMin: number | null) => void; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title ?? ""); const [due, setDue] = useState<Date | null>(task?.dueAt ? new Date(task.dueAt) : null); const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium"); const [remind, setRemind] = useState("none"); const [err, setErr] = useState("");
  const submit = () => {
    if (!title.trim()) return setErr("Title is required."); if (title.length > 120) return setErr("Title must be 120 characters or fewer.");
    const min = remind === "none" ? null : Number(remind);
    if (min !== null) { if (!due) return setErr("Set a due date to add a reminder."); if (due.getTime() - min * 60000 < Date.now() - 60000) return setErr("That reminder time has already passed. Choose a later due date or a shorter lead time."); }
    onSave({ title: title.trim(), priority, dueAt: due?.toISOString() }, min);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={task ? "Edit task" : "New task"} tall footer={<View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Button label="Cancel" wide onPress={onClose} /></View><View style={{ flex: 1 }}><Button label="Save" kind="primary" wide onPress={submit} /></View></View>}>
      <View style={{ gap: 16, paddingTop: 8, paddingBottom: 8 }}>
        <TextField label="Title" value={title} onChangeText={(t) => { setTitle(t); setErr(""); }} autoFocus={!task} error={err} maxLength={130} returnKeyType="done" />
        <DateField label="Due" value={due} onChange={setDue} />
        <View style={{ gap: 6 }}><Text variant="small" weight="medium">Remind me</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, opacity: due ? 1 : 0.45 }} pointerEvents={due ? "auto" : "none"}>{REMIND.map((r) => <Chip key={r.v} label={r.l} on={remind === r.v} onPress={() => setRemind(r.v)} />)}</View>
          {due && remind !== "none" && !channelReady ? <Text variant="small" color="#f4c56a">Notifications isn't set up, so this will wait until it is.</Text> : null}</View>
        <View style={{ gap: 6 }}><Text variant="small" weight="medium">Priority</Text><Segmented value={priority} onChange={setPriority} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} /></View>
      </View>
    </Sheet>
  );
}

function Action({ bg, children }: { bg: string; children: React.ReactNode }) { return <View style={{ width: 88, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>{children}</View>; }
