import { useState } from "react";
import type { ChatEvidence } from "@meeting-notes/shared";
import { EvidenceCard } from "./EvidenceCard";
import { IconQuote } from "../icons";

/**
 * Evidence stays out of the way: one line with the count and numbered chips. Tapping a chip (or an [E#] in the
 * answer) opens just that card; "모두 보기" expands everything for the rare case the reader wants the full list.
 */
export function EvidencePanel({ items, msgKey, activeId, onActivate }: { items: ChatEvidence[]; msgKey: string; activeId: string | null; onActivate: (id: string | null) => void }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.filter((e) => e.id === activeId);
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3"><IconQuote size={13} />근거 {items.length}건</span>
        <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {items.map((e) => (
            <button key={e.id} type="button" onClick={() => onActivate(activeId === e.id ? null : e.id)} className={`tap inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold ${activeId === e.id ? "bg-accent text-white" : "bg-accent-soft text-accent"}`}>
              {e.id}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAll((v) => !v)} className="tap shrink-0 text-[12px] text-ink-3">{all ? "접기" : "모두 보기"}</button>
      </div>
      {shown.length > 0 && (
        <div className="mt-2 space-y-2">
          {shown.map((e) => <EvidenceCard key={e.id} item={e} domId={`ev-${msgKey}-${e.id}`} highlighted={activeId === e.id} />)}
        </div>
      )}
    </div>
  );
}
