import type { ReactNode } from "react";
import type { Tone } from "@/lib/evidence";
import type { CompanyDocument } from "@/lib/types";
import { documentLabel } from "@/lib/evidence";

export type Status = { tone: Tone; label: string };

type FactRowProps = {
  id: string;
  label: string;
  hint?: string;
  value: ReactNode;
  status?: Status | null;
  proof?: ReactNode;
  editing?: boolean;
  editor?: ReactNode;
  onEdit?: () => void;
  action?: ReactNode;
  // rows that take a document as proof accept files dropped on them
  proofKey?: string;
  dropActive?: boolean;
  // full-width strip under the row (upload progress, review)
  below?: ReactNode;
};

export function LedgerTable({
  id,
  title,
  note,
  children,
  footer,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="ledger-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="ledger-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {note ? <span>{note}</span> : null}
      </div>
      <div className="ledger" role="table" aria-labelledby={`${id}-title`}>
        <div className="ledger-row ledger-head" role="row">
          <span role="columnheader">Fact</span>
          <span role="columnheader">Value</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Proof</span>
          <span role="columnheader">
            <span className="sr-only">Actions</span>
          </span>
        </div>
        {children}
        {footer ? <div className="ledger-footer">{footer}</div> : null}
      </div>
    </section>
  );
}

export function FactRow({
  id,
  label,
  hint,
  value,
  status,
  proof,
  editing = false,
  editor,
  onEdit,
  action,
  proofKey,
  dropActive = false,
  below,
}: FactRowProps) {
  const flagged = status?.tone === "warn";
  return (
    <div
      className={`ledger-row${flagged ? " ledger-row-flagged" : ""}${editing ? " ledger-row-editing" : ""}${dropActive ? " ledger-row-drop" : ""}`}
      id={`fact-${id}`}
      role="row"
      data-proof-key={proofKey}
    >
      <div className="fact-name" role="rowheader">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      {editing && editor ? (
        <div className="fact-editor" role="cell">
          {editor}
        </div>
      ) : (
        <>
          <div className="fact-value" role="cell">
            {value}
          </div>
          <div role="cell" className="fact-status">
            {status ? <StatusPill status={status} /> : <span className="fact-empty">—</span>}
          </div>
          <div role="cell" className="fact-proof">
            {proof ?? <span className="fact-empty">—</span>}
          </div>
          <div role="cell" className="fact-action">
            {action ??
              (onEdit ? (
                <button type="button" className="link-button" onClick={onEdit}>
                  Edit<span className="sr-only"> {label}</span>
                </button>
              ) : null)}
          </div>
        </>
      )}
      {dropActive ? <span className="row-drop-hint">Drop to attach as {label} proof</span> : null}
      {below ? <div className="fact-below">{below}</div> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill pill-${status.tone}`}>{status.label}</span>;
}

export function DocChip({
  document,
  onOpen,
}: {
  document: Pick<CompanyDocument, "original_name" | "mime_type">;
  onOpen?: () => void;
}) {
  const kind = document.original_name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
  const content = (
    <>
      <span className="doc-chip-kind">{kind}</span>
      <span className="doc-chip-name">{documentLabel(document.original_name)}</span>
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className="doc-chip"
      onClick={onOpen}
      title={`Open ${document.original_name}`}
    >
      {content}
    </button>
  ) : (
    <span className="doc-chip" title={document.original_name}>
      {content}
    </span>
  );
}
