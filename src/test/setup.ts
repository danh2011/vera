import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => { cleanup(); localStorage.clear(); });
import { beforeEach } from "vitest";
beforeEach(() => { localStorage.setItem("vera:v1:settings", JSON.stringify({ onboarded: true })); });
