import type { CompetitionRisk } from "@/lib/competition-risk";

// Shows the "a dedo" check: a short chip in lists, and the reasons with their evidence
// where there's room. Wording stays factual: patterns in public data, not accusations.

export function RiskChip({ risk }: { risk: CompetitionRisk }) {
  return (
    <span className={`tag-badge risk-chip risk-${risk.level}`} title={risk.signals.map((signal) => signal.text).join(" · ")}>
      {risk.label}
    </span>
  );
}

export function RiskNote({ risk, compact = false }: { risk: CompetitionRisk; compact?: boolean }) {
  return (
    <div className={`risk-note risk-${risk.level}${compact ? " risk-note-compact" : ""}`} role="note">
      <p className="risk-note-head">
        <span aria-hidden="true">⚑</span> <b>{risk.label}</b>
        {risk.level === "high" ? <span> · probably not worth your time</span> : <span> · check before you invest time</span>}
      </p>
      <ul>
        {risk.signals.map((signal) => (
          <li key={signal.key}>
            <span>{signal.text}</span>
            {compact ? null : <small>{signal.evidence}</small>}
          </li>
        ))}
      </ul>
      {compact ? null : <p className="risk-note-foot">Patterns in public award data, not proof of wrongdoing.</p>}
    </div>
  );
}
