import type { ChatStep } from "@meeting-notes/shared";
import { IconBrain, IconCheck, IconSearch, IconTool, Spinner } from "../icons";

export interface LiveStep extends ChatStep {
  state: "running" | "done" | "error";
}

/** What the agent is doing right now (or did, for a stored answer): thinking, searching, reading a document. */
export function StepsTimeline({ steps, thinking, thinkingText, collapsed }: { steps: LiveStep[]; thinking?: boolean; thinkingText?: string; collapsed?: boolean }) {
  if (!steps.length && !thinking) return null;
  return (
    <ol className={`space-y-1.5 text-[12.5px] ${collapsed ? "text-ink-3" : "text-ink-2"}`}>
      {thinking && (
        <li className="flex items-start gap-2">
          <span className="mt-0.5 text-violet"><IconBrain size={15} /></span>
          <div className="min-w-0 flex-1">
            <span className="font-medium">생각하는 중</span>
            {thinkingText && <p className="mt-0.5 line-clamp-3 text-ink-3 whitespace-pre-wrap">{thinkingText.slice(-320)}</p>}
          </div>
          <Spinner size={13} className="mt-0.5 text-ink-3" />
        </li>
      )}
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2">
          <span className={`mt-0.5 ${s.state === "error" ? "text-danger" : "text-accent"}`}>{s.name.endsWith("search_meetings") ? <IconSearch size={15} /> : <IconTool size={15} />}</span>
          <span className="min-w-0 flex-1 truncate">{s.title}</span>
          {s.state === "running" ? <Spinner size={13} className="mt-0.5 text-ink-3" /> : <span className="shrink-0 text-ink-3">{s.result}{s.state === "done" && !s.result ? <IconCheck size={14} /> : null}</span>}
        </li>
      ))}
    </ol>
  );
}
