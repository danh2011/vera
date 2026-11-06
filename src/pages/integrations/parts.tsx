import { AlertTriangle, CheckCircle2, CircleSlash, Cloud, HardDrive, KeyRound, Lock, XCircle } from "lucide-react";
import type { IntegrationSummary, TestCode } from "../../../shared/types";
import { TEST_COPY, TONE, iconFor } from "./util";

export function StatusBadge({ s }: { s: Pick<IntegrationSummary, "status" | "statusLabel"> }) {
  return <span className={`status ${TONE[s.status]}`} data-status={s.status}>{s.status === "connected" || s.status === "ready" ? <CheckCircle2 size={12} aria-hidden /> : s.status === "error" ? <XCircle size={12} aria-hidden /> : s.status === "unavailable" ? <CircleSlash size={12} aria-hidden /> : s.status === "needs_setup" || s.status === "needs_authorisation" || s.status === "degraded" ? <AlertTriangle size={12} aria-hidden /> : null}{s.statusLabel}</span>;
}
export function Where({ s }: { s: Pick<IntegrationSummary, "runsLocally" | "contactsExternalServices" | "requiresCredentials" | "authMode"> }) {
  return (
    <span className="tags">
      <span className="tag">{s.contactsExternalServices ? <Cloud size={11} aria-hidden /> : <HardDrive size={11} aria-hidden />}{s.contactsExternalServices ? "Uses a network service" : "Works locally"}</span>
      <span className="tag">{s.requiresCredentials ? <KeyRound size={11} aria-hidden /> : <Lock size={11} aria-hidden />}{s.authMode === "oauth" ? "Sign-in required" : s.requiresCredentials ? "Needs credentials" : "No setup"}</span>
    </span>
  );
}
export const IntIcon = ({ name, size = 22 }: { name: string; size?: number }) => { const I = iconFor(name); return <span className="int-icon" aria-hidden><I size={size} /></span>; };

export function TestResultView({ code, message, at }: { code: TestCode; message: string; at?: string }) {
  const c = TEST_COPY[code];
  return (
    <div className={`result ${c.tone}`} role="status">
      <strong>{c.tone === "ok" ? <CheckCircle2 size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />} {c.title}</strong>
      <p>{message}</p>{c.hint && <p className="small muted">{c.hint}</p>}{at && <p className="small muted">Tested {new Date(at).toLocaleString()}</p>}
    </div>
  );
}
