import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "react-oidc-context";
import type { ChatEvidence, ChatMessageDto, ChatStreamEvent } from "@meeting-notes/shared";
import { useApi } from "../lib/api";
import { useConfig } from "../lib/use-config";
import { streamChatTurn } from "../lib/chat-stream";
import { useStickToBottom } from "../lib/stick-to-bottom";
import { AnswerText } from "../components/chat/AnswerText";
import { EvidencePanel } from "../components/chat/EvidencePanel";
import { StepsTimeline, type LiveStep } from "../components/chat/StepsTimeline";
import { IconAlert, IconChevronDown, IconChevronLeft, IconSend } from "../components/icons";
import { InlineError, Pill, Skeleton } from "../components/ui";
import { BetaBadge } from "./ChatListPage";

/** A message as rendered: stored ones come from the API, the live one is built from stream events. */
interface ViewMessage {
  key: string;
  role: "user" | "assistant";
  text: string;
  steps: LiveStep[];
  evidence: ChatEvidence[];
  options?: string[];
  thinking?: string;
  streaming?: boolean;
  error?: string;
}

const fromDto = (m: ChatMessageDto): ViewMessage => ({ key: `m${m.seq}`, role: m.role, text: m.text, steps: (m.steps ?? []).map((s) => ({ ...s, state: "done" })), evidence: m.evidence ?? [], ...(m.options?.length ? { options: m.options } : {}) });

export function ChatPage() {
  const { sessionId = "" } = useParams();
  const api = useApi();
  const cfg = useConfig();
  const auth = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["chat", sessionId], queryFn: () => api.getChatMessages(sessionId), refetchOnWindowFocus: false });
  const [live, setLive] = useState<ViewMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stored = (q.data?.items ?? []).map(fromDto);
  const messages = [...stored, ...live];

  // Follow the newest content unless the reader scrolled away; the signature grows with every streamed delta.
  const last = messages[messages.length - 1];
  const { away, follow, scrollToBottom } = useStickToBottom(`${messages.length}:${last?.text.length ?? 0}:${last?.steps.length ?? 0}:${last?.evidence.length ?? 0}:${last?.options?.length ?? 0}:${busy}`);
  useEffect(() => () => abortRef.current?.abort(), []);

  const focusEvidence = useCallback((id: string | null, msgKey: string) => {
    setHighlight(id ? `${msgKey}:${id}` : null);
    if (id) requestAnimationFrame(() => document.getElementById(`ev-${msgKey}-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, []);

  async function send(text = input) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    follow(); // sending always brings the conversation back to the bottom
    const userMsg: ViewMessage = { key: `u${Date.now()}`, role: "user", text: message, steps: [], evidence: [] };
    const key = `a${Date.now()}`;
    let draft: ViewMessage = { key, role: "assistant", text: "", steps: [], evidence: [], streaming: true };
    setLive((prev) => [...prev, userMsg, draft]);
    const update = (patch: (d: ViewMessage) => ViewMessage) => {
      draft = patch(draft);
      const snapshot = draft;
      setLive((prev) => prev.map((m) => (m.key === key ? snapshot : m)));
    };
    const onEvent = (ev: ChatStreamEvent) => {
      switch (ev.type) {
        case "thinking":
          update((d) => ({ ...d, thinking: (d.thinking ?? "") + ev.delta }));
          break;
        case "text":
          update((d) => ({ ...d, text: d.text + ev.delta, thinking: undefined }));
          break;
        case "tool_use":
          update((d) => ({ ...d, thinking: undefined, steps: [...d.steps, { id: ev.id, name: ev.name, title: ev.title, state: "running" }] }));
          break;
        case "tool_result":
          update((d) => ({ ...d, steps: d.steps.map((s) => (s.id === ev.id ? { ...s, state: ev.isError ? "error" : "done", result: ev.summary } : s)) }));
          break;
        case "evidence":
          update((d) => ({ ...d, evidence: [...d.evidence, ...ev.items] }));
          break;
        case "clarify":
          update((d) => ({ ...d, options: ev.options, thinking: undefined }));
          break;
        case "error":
          update((d) => ({ ...d, error: ev.message, streaming: false }));
          break;
        case "done":
          update((d) => ({ ...d, streaming: false, thinking: undefined }));
          break;
        default:
          break;
      }
    };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChatTurn({ apiBase: cfg.apiBase, token: auth.user?.id_token, body: { sessionId, message }, onEvent, signal: controller.signal });
    } catch (err) {
      if (!controller.signal.aborted) update((d) => ({ ...d, error: (err as Error).message || "연결이 끊어졌습니다", streaming: false }));
    } finally {
      update((d) => ({ ...d, streaming: false }));
      setBusy(false);
      // Stored history now includes this turn; swap the live copy for the server version.
      await qc.invalidateQueries({ queryKey: ["chat", sessionId] });
      await qc.invalidateQueries({ queryKey: ["chat-sessions"] });
      setLive([]);
    }
  }

  const session = q.data?.session;
  return (
    <div className="flex min-h-full flex-col px-4 pt-2">
      <div className="flex items-center gap-2">
        <button className="tap -ml-1 inline-flex h-9 items-center gap-0.5 pr-2 text-[15px] text-accent" onClick={() => nav("/chat")}><IconChevronLeft size={20} />대화</button>
        <BetaBadge />
        {session?.meetingId && <Pill tone="accent" dot>이 회의로 제한</Pill>}
      </div>
      {q.isLoading && <div className="mt-4 space-y-3"><Skeleton className="h-16" /><Skeleton className="h-24" /></div>}
      {q.error && <InlineError>{String((q.error as Error).message)}</InlineError>}

      <div className="flex-1 space-y-5 py-4">
        {q.data && messages.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface p-4 text-[14px] leading-relaxed text-ink-2">
            <p className="font-semibold text-ink">무엇이든 물어보세요</p>
            <p className="mt-1">예: 지난 회의에서 결제 모듈 타임아웃은 어떻게 결정되었나요? 이서현 님이 맡은 일은 무엇인가요?</p>
            <p className="mt-2 text-[12.5px] text-ink-3">답변의 각 문장에는 근거 번호가 붙고, 아래 근거 카드에서 해당 회의록 구절과 전사 위치를 열 수 있습니다.</p>
          </div>
        )}
        {messages.map((m, i) => (m.role === "user" ? <UserBubble key={m.key} text={m.text} /> : <AssistantBlock key={m.key} m={m} activeEvidence={highlight?.startsWith(`${m.key}:`) ? highlight.slice(m.key.length + 1) : null} onRef={(id) => focusEvidence(id, m.key)} onPick={i === messages.length - 1 && !busy ? (o) => void send(o) : undefined} />))}
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 px-4 pb-3 pt-2 backdrop-blur">
        {away && (
          <button type="button" onClick={follow} aria-label="맨 아래로" className="tap absolute -top-11 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-1 rounded-full border border-line-2 bg-surface-2 px-3.5 text-[13px] font-medium text-ink shadow-card">
            {busy ? "새 답변 보기" : "맨 아래로"}<IconChevronDown size={16} />
          </button>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            onFocus={() => setTimeout(() => { if (!away) scrollToBottom(); }, 500)}
            placeholder={session?.meetingId ? "이 회의에 대해 질문" : "회의에 대해 질문"}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line-2 bg-surface-2 px-3.5 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="보내기" className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-white shadow-glow disabled:opacity-40"><IconSend size={20} /></button>
        </form>
        <p className="mt-1.5 text-[11px] text-ink-3">베타: 답변은 회의록과 전사 내용에 근거하며, 확인되지 않은 내용은 그렇게 표시됩니다.</p>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">{text}</p>
    </div>
  );
}

function AssistantBlock({ m, activeEvidence, onRef, onPick }: { m: ViewMessage; activeEvidence: string | null; onRef: (id: string | null) => void; onPick?: (option: string) => void }) {
  const working = !!m.streaming && !m.text;
  return (
    <div className="space-y-3">
      {(m.steps.length > 0 || m.thinking !== undefined) && (
        <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
          <StepsTimeline steps={m.steps} thinking={working && m.thinking !== undefined && !m.steps.some((s) => s.state === "running")} thinkingText={m.thinking} collapsed={!m.streaming} />
        </div>
      )}
      {working && m.thinking === undefined && m.steps.length === 0 && <div className="flex items-center gap-2 text-[13px] text-ink-3"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />답변을 준비하는 중</div>}
      {m.text && <AnswerText text={m.text} onRef={onRef} streaming={m.streaming} />}
      {m.error && (
        <div className="flex gap-2 rounded-xl bg-danger-soft p-3 text-[13px] text-danger"><IconAlert size={16} className="mt-0.5 shrink-0" /><p>{m.error}</p></div>
      )}
      {m.options && m.options.length > 0 && !m.streaming && (
        <div className="flex flex-wrap gap-2">
          {m.options.map((o) => (
            <button key={o} type="button" disabled={!onPick} onClick={() => onPick?.(o)} className="tap rounded-full border border-accent/40 bg-accent-soft px-3.5 py-2 text-[13.5px] font-medium text-accent disabled:opacity-50 active:scale-[0.98]">
              {o}
            </button>
          ))}
        </div>
      )}
      {m.evidence.length > 0 && <EvidencePanel items={m.evidence} msgKey={m.key} activeId={activeEvidence} onActivate={onRef} />}
    </div>
  );
}
