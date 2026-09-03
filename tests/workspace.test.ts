import { describe, it, expect } from "vitest";
import { resolveWorkspacePath } from "../src/server/security/workspace.js";

describe("workspace path sandboxing", () => {
  it("resolves normal relative paths inside the workspace", () => {
    expect(() => resolveWorkspacePath("notes/todo.txt")).not.toThrow();
  });

  it("blocks path traversal attempts", () => {
    expect(() => resolveWorkspacePath("../../etc/passwd")).toThrow();
    expect(() => resolveWorkspacePath("../secrets.env")).toThrow();
    expect(() => resolveWorkspacePath("a/../../../etc/passwd")).toThrow();
  });
});
