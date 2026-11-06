import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { App } from "../App";
import { Providers } from "../context";
import { HttpVeraApi } from "../services/http";
import { MockVeraApi } from "../services/mock";
import { createApi } from "../services";

const mount = (path = "/chat") => render(<Providers api={new MockVeraApi(5)}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Providers>);

test("renders and navigates", async () => {
  mount(); expect(await screen.findByText(/What can I help you with/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: /tasks/i }));
  expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
});
test("sending a message yields a response labelled as demo", async () => {
  mount(); await userEvent.type(await screen.findByLabelText("Message"), "hello there{Enter}");
  expect(await screen.findByText(/no AI model is connected/i, {}, { timeout: 4000 })).toBeInTheDocument();
  expect(screen.getAllByText("hello there").length).toBeGreaterThan(0);
});
test("task create, complete, delete", async () => {
  mount("/tasks"); await userEvent.click(await screen.findByText("Add task"));
  await userEvent.type(screen.getByLabelText("Title"), "Buy milk"); await userEvent.click(screen.getByText("Save"));
  const box = await screen.findByLabelText(/Mark "Buy milk" complete/); await userEvent.click(box);
  await waitFor(() => expect(screen.getByLabelText(/Mark "Buy milk" open/)).toBeChecked());
  await userEvent.click(screen.getByLabelText("Delete Buy milk")); await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText("Buy milk")).toBeNull());
});
test("memory create validates and saves", async () => {
  mount("/memory"); await userEvent.click(await screen.findByText("Add memory")); await userEvent.click(screen.getByText("Save"));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Title"), "T"); await userEvent.type(screen.getByLabelText("Content"), "C"); await userEvent.click(screen.getByText("Save"));
  expect(await screen.findByText("T")).toBeInTheDocument();
});
test("clearing data needs confirmation", async () => {
  mount("/settings"); await userEvent.click(await screen.findByText("Clear all data"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Cancel")); expect(screen.queryByRole("dialog")).toBeNull();
});
test("malformed storage does not crash", async () => {
  localStorage.setItem("vera:v1:seeded", "true"); localStorage.setItem("vera:v1:tasks", "{oops"); localStorage.setItem("vera:v1:conversations", JSON.stringify([1, null]));
  mount("/tasks"); expect(await screen.findByText(/No tasks yet/)).toBeInTheDocument();
});
test("persists across remount", async () => {
  const api = new MockVeraApi(1); await api.createConversation();
  expect(await new MockVeraApi(1).listConversations()).toHaveLength(1);
});
test("mock makes no network requests", async () => {
  const f = vi.fn(); vi.stubGlobal("fetch", f);
  const c = await new MockVeraApi(1).createConversation(); await new MockVeraApi(1).sendMessage(c.id, { content: "hi" });
  expect(f).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
test("production uses the real backend by default and can never use the mock", () => {
  expect(createApi(undefined, true)).toBeInstanceOf(HttpVeraApi); expect(createApi("http", true)).toBeInstanceOf(HttpVeraApi); expect(createApi("", true)).toBeInstanceOf(HttpVeraApi);
  expect(() => createApi("mock", true)).toThrow(/disabled in production/); expect(() => createApi("bogus", true)).toThrow(/Unsupported/);
  expect(createApi("mock", false)).toBeInstanceOf(MockVeraApi);
});
test("mock mode does not fabricate integration state", async () => { await expect(new MockVeraApi(1).integrations.catalogue()).rejects.toThrow(/need the Vera backend/); });
test("usable without speech recognition", async () => {
  mount(); expect(await screen.findByLabelText("Voice input unavailable")).toBeDisabled();
});
test("onboarding saves profile and personalises greeting", async () => {
  localStorage.setItem("vera:v1:settings", JSON.stringify({ onboarded: false }));
  mount(); await userEvent.type(await screen.findByLabelText(/call you/i), "Dan");
  await userEvent.click(screen.getByText("Next")); await userEvent.click(screen.getByText("Music"));
  await userEvent.click(screen.getByText("Next")); await userEvent.click(screen.getByLabelText("Blue"));
  await userEvent.click(screen.getByText("Next")); await userEvent.click(screen.getByLabelText("Allow files")); await userEvent.click(screen.getByText("Finish"));
  expect(await screen.findByText(/Hello, Dan/)).toBeInTheDocument();
  expect(document.documentElement.dataset.accent).toBe("blue");
  expect(JSON.parse(localStorage.getItem("vera:v1:settings") ?? "{}")).toMatchObject({ name: "Dan", interests: ["Music"], accent: "blue", allowFiles: true, allowTools: false, onboarded: true });
});
