import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useApi, useSettings } from "./context";
import type { Accent } from "./types";

export const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: "neutral", label: "Graphite", color: "#ececec" }, { id: "blue", label: "Blue", color: "#5aa2ff" }, { id: "teal", label: "Teal", color: "#2dd4bf" },
  { id: "green", label: "Green", color: "#4ade80" }, { id: "amber", label: "Amber", color: "#fbbf24" }, { id: "orange", label: "Orange", color: "#fb923c" },
];
const SUGGESTED = ["Coding", "Home lab", "Music", "Gaming", "Photography", "Reading", "Fitness", "Cooking", "Science", "Travel", "Finance", "Design"];

export function AccentPicker({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }) {
  return <div className="swatches" role="radiogroup" aria-label="Accent colour">{ACCENTS.map((a) => (
    <button key={a.id} role="radio" aria-checked={value === a.id} aria-label={a.label} title={a.label} className="swatch" style={{ background: a.color }} onClick={() => onChange(a.id)}>{value === a.id && <Check size={18} />}</button>))}</div>;
}

export function InterestsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const add = () => { const t = text.trim().slice(0, 30); if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...value, t]); setText(""); };
  const all = [...SUGGESTED, ...value.filter((v) => !SUGGESTED.includes(v))];
  return (
    <div>
      <div className="chips">{all.map((t) => <button key={t} type="button" className={`tag ${value.includes(t) ? "on" : ""}`} aria-pressed={value.includes(t)} onClick={() => toggle(t)}>{t}</button>)}</div>
      <input aria-label="Add an interest" placeholder="Add your own and press Enter" value={text} maxLength={30} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
    </div>
  );
}

const STEPS = 4;
export function Onboarding({ onClose }: { onClose?: () => void }) {
  const { settings, update } = useSettings(); const api = useApi();
  const [step, setStep] = useState(0);
  const [d, setD] = useState({ name: settings.name, interests: settings.interests, accent: settings.accent, allowFiles: settings.allowFiles, allowTools: settings.allowTools });
  const original = useRef(settings.accent);
  useEffect(() => { document.documentElement.dataset.accent = d.accent; }, [d.accent]); // live preview
  useEffect(() => () => { document.documentElement.dataset.accent = original.current; }, []);
  useEffect(() => { if (!onClose) return; const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const finish = (save: boolean) => { update(save ? { ...d, name: d.name.trim(), onboarded: true } : { onboarded: true }); original.current = save ? d.accent : settings.accent; onClose?.(); };
  const last = step === STEPS - 1;
  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="Set up Vera">
      <div className="onb-card">
        <div className="onb-dots" aria-hidden>{Array.from({ length: STEPS }, (_, i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>
        <div className="onb-step" key={step}>
          {step === 0 && <><h1>Welcome to Vera</h1><p className="lead">Let's personalise things. Everything you enter stays on this device.</p>
            <label>What should Vera call you?<input autoFocus value={d.name} maxLength={40} placeholder="Your name" onChange={(e) => setD({ ...d, name: e.target.value })} /></label></>}
          {step === 1 && <><h1>What are you into?</h1><p className="lead">Pick a few interests. Vera uses them for suggestions.</p><InterestsEditor value={d.interests} onChange={(interests) => setD({ ...d, interests })} /></>}
          {step === 2 && <><h1>Pick an accent colour</h1><p className="lead">You can change this any time in Settings.</p><AccentPicker value={d.accent} onChange={(accent) => setD({ ...d, accent })} /></>}
          {step === 3 && <><h1>Access</h1><p className="lead">{api.kind === "mock" ? "Choose what Vera may use once these features exist. Neither is built yet, so nothing is accessed today; this only saves your preference." : "Vera can only use what you switch on. Abilities such as files, your home server, Home Assistant, calendar and media live in Integrations: install one, follow its short setup, and decide which permissions it gets. Sensitive ones start off, and banking details are never sent to any cloud AI."}</p>
            {api.kind === "mock" && <div className="perm"><div className="grow"><strong>Files</strong><small>Search and read files you point it at</small></div><label className="check"><input type="checkbox" aria-label="Allow files" checked={d.allowFiles} onChange={(e) => setD({ ...d, allowFiles: e.target.checked })} /></label></div>}
            {api.kind === "mock" && <div className="perm"><div className="grow"><strong>Tools and integrations</strong><small>Home server, calendar and other connected tools</small></div><label className="check"><input type="checkbox" aria-label="Allow tools" checked={d.allowTools} onChange={(e) => setD({ ...d, allowTools: e.target.checked })} /></label></div>}</>}
        </div>
        <div className="onb-nav">
          {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>Back</button> : <button className="btn" onClick={() => finish(false)}>{onClose ? "Cancel" : "Skip setup"}</button>}
          <span className="grow" />
          {last ? <button className="btn primary" onClick={() => finish(true)}>Finish</button> : <button className="btn primary" onClick={() => setStep(step + 1)}>Next</button>}
        </div>
      </div>
    </div>
  );
}
