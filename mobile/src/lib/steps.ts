import type { ChatStep } from "../api/types";

/** Replace a step with the same id (running → done) or append a new one. */
export const upsertStep = (steps: ChatStep[], st: ChatStep): ChatStep[] => { const i = steps.findIndex((x) => x.id === st.id); return i >= 0 ? steps.map((x, k) => (k === i ? st : x)) : [...steps, st]; };
