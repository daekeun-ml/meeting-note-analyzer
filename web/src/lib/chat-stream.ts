import type { ChatStreamEvent, ChatTurnRequest } from "@meeting-notes/shared";

/**
 * POST one chat turn and deliver the runtime's server-sent events as they arrive. Plain fetch instead of EventSource:
 * the request needs a body and a bearer token. Resolves when the stream ends; rejects only on transport failure.
 */
export async function streamChatTurn(opts: { apiBase: string; token: string | undefined; body: ChatTurnRequest; onEvent: (ev: ChatStreamEvent) => void; signal?: AbortSignal }): Promise<void> {
  const body = JSON.stringify(opts.body);
  // CloudFront signs the origin request to the Lambda Function URL (OAC) and overwrites Authorization, so the token goes in
  // x-mna-token; signed POSTs also require the payload hash in x-amz-content-sha256.
  const res = await fetch(`${opts.apiBase}/chat-stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", "x-amz-content-sha256": await sha256Hex(body), ...(opts.token ? { "x-mna-token": opts.token } : {}) },
    body,
    signal: opts.signal,
  });
  if (!res.body) throw new Error(`빈 응답 (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const ev of parseFrame(frame)) opts.onEvent(ev);
    }
  }
  for (const ev of parseFrame(buffer)) opts.onEvent(ev);
  if (!res.ok && res.status !== 200) opts.onEvent({ type: "error", message: `HTTP ${res.status}` });
}

export function parseFrame(frame: string): ChatStreamEvent[] {
  const out: ChatStreamEvent[] = [];
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      const ev = JSON.parse(raw) as ChatStreamEvent;
      if (ev && typeof ev === "object" && "type" in ev) out.push(ev);
    } catch {
      // partial or non-JSON data line: ignore
    }
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
