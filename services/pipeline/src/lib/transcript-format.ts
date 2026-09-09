import type { Transcript } from "@meeting-notes/shared";

export function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Human/agent-readable transcript: one line per segment with time, speaker, id. */
export function transcriptToMarkdown(t: Transcript, title: string): string {
  const lines = [
    `# ${title}`,
    "",
    `- duration: ${hms(t.durationSec)}, language: ${t.language ?? "unknown"}, speakers: ${t.speakers.map((s) => s.id).join(", ")}`,
    "",
  ];
  const pendingNames = t.speakers.filter((s) => s.reviewRequired && !s.nameConfirmedByUser);
  if (pendingNames.length) lines.push(...pendingNames.map((s) => `- ${s.id}: [speaker name review required]${s.proposedLabel ? ` candidate: ${s.proposedLabel}` : ""}`), "");
  for (const seg of t.segments) {
    const label = seg.speakerLabel && seg.speakerLabel !== seg.speaker ? `${seg.speaker} (${seg.speakerLabel})` : seg.speaker;
    const review = seg.speakerReviewRequired ? " [speaker review required]" : "";
    lines.push(`[${hms(seg.start)}] ${label}${review} (${seg.id}): ${seg.text}`);
  }
  return lines.join("\n") + "\n";
}
