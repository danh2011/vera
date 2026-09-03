import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the server at an isolated, throwaway database + workspace before any
// server module is imported, so these tests never touch real user data.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vera-test-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.WORKSPACE_PATH = path.join(tmpDir, "workspace");

const { memoryCapability } = await import("../src/server/capabilities/memory.js");
const { tasksCapability } = await import("../src/server/capabilities/tasks.js");
const { filesCapability } = await import("../src/server/capabilities/files.js");

function action(cap: any, name: string) {
  return cap.actions.find((a: any) => a.name === name);
}

describe("memory capability", () => {
  it("remembers, recalls, updates, and forgets", async () => {
    const remember = action(memoryCapability, "memory_remember");
    const recall = action(memoryCapability, "memory_recall");
    const update = action(memoryCapability, "memory_update");
    const forget = action(memoryCapability, "memory_forget");

    const created = await remember.execute({ content: "Prefers dark mode.", category: "preferences", importance: 4 });
    expect(created.ok).toBe(true);
    const id = (created.data as any).id;

    const found = await recall.execute({ query: "dark mode", limit: 10 });
    expect(found.ok).toBe(true);
    expect((found.data as any[]).some((m) => m.id === id)).toBe(true);

    const updated = await update.execute({ id, content: "Prefers light mode now." });
    expect(updated.ok).toBe(true);

    const forgotten = await forget.execute({ id });
    expect(forgotten.ok).toBe(true);

    const afterForget = await recall.execute({ query: "light mode", limit: 10 });
    expect((afterForget.data as any[]).some((m) => m.id === id)).toBe(false);
  });
});

describe("tasks capability", () => {
  it("creates, lists, completes tasks", async () => {
    const create = action(tasksCapability, "tasks_create");
    const list = action(tasksCapability, "tasks_list");
    const complete = action(tasksCapability, "tasks_complete");

    const created = await create.execute({ title: "Research PC build", priority: "high" });
    expect(created.ok).toBe(true);
    const id = (created.data as any).id;

    const open = await list.execute({ status: "open" });
    expect((open.data as any[]).some((t) => t.id === id)).toBe(true);

    await complete.execute({ id });
    const stillOpen = await list.execute({ status: "open" });
    expect((stillOpen.data as any[]).some((t) => t.id === id)).toBe(false);
  });
});

describe("files capability", () => {
  it("creates and reads a file within the sandboxed workspace", async () => {
    const create = action(filesCapability, "files_create");
    const read = action(filesCapability, "files_read");

    const created = await create.execute({ path: "notes/todo.txt", content: "buy GPU" });
    expect(created.ok).toBe(true);

    const result = await read.execute({ path: "notes/todo.txt" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe("buy GPU");
  });

  it("refuses to escape the workspace", async () => {
    const read = action(filesCapability, "files_read");
    const result = await read.execute({ path: "../../etc/passwd" });
    expect(result.ok).toBe(false);
  });
});
