import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Transcript as TranscriptDoc } from "@meeting-notes/shared";
import { urlPath, useStableUrl } from "../lib/stable-url";
import { AudioPlayer, hms, type AudioPlayerHandle } from "./AudioPlayer";
import { Avatar, InlineError, Skeleton, speakerColorClass } from "./ui";

export function Transcript({ transcriptUrl, audioUrl, speakerLabels }: { transcriptUrl: string; audioUrl: string | null; speakerLabels: Record<string, string> }) {
  const [stableTranscript] = useStableUrl(transcriptUrl);
  const [stableAudio, refreshAudio] = useStableUrl(audioUrl);
  const [current, setCurrent] = useState(0);
  const player = useRef<AudioPlayerHandle>(null);

  // Keyed on the object path: a new signature on the same object must not refetch, a new object (attributed transcript) must.
  const q = useQuery({
    queryKey: ["transcript", urlPath(stableTranscript)],
    queryFn: async () => {
      const r = await fetch(stableTranscript!);
      if (!r.ok) throw new Error(`전사를 불러오지 못했습니다 (${r.status})`);
      return (await r.json()) as TranscriptDoc;
    },
    enabled: !!stableTranscript,
    staleTime: Infinity,
  });

  const speakerIds = useMemo(() => Array.from(new Set((q.data?.segments ?? []).map((s) => s.speaker))), [q.data]);
  const label = (id: string) => speakerLabels[id] ?? id;

  if (q.error) return <InlineError>{(q.error as Error).message}</InlineError>;
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;

  return (
    <div>
      {stableAudio && (
        <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-2 bg-bg/95 backdrop-blur">
          <AudioPlayer ref={player} src={stableAudio} onTime={setCurrent} onError={refreshAudio} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-2 mb-3">
        {speakerIds.map((id, i) => (
          <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-line pl-1 pr-2.5 py-1 text-xs">
            <Avatar name={label(id)} index={i} size={20} />
            <span className={`font-semibold ${speakerColorClass(i)}`}>{label(id)}</span>
          </span>
        ))}
      </div>
      <ol className="space-y-1">
        {q.data.segments.map((seg, idx) => {
          const active = current >= seg.start && current < seg.end;
          const si = speakerIds.indexOf(seg.speaker);
          const newSpeaker = idx === 0 || q.data!.segments[idx - 1]?.speaker !== seg.speaker;
          return (
            <li key={seg.id}>
              <button onClick={() => player.current?.seek(seg.start)} className={`tap w-full text-left rounded-xl px-3 py-2 transition-colors ${active ? "bg-accent-soft ring-1 ring-accent/40" : "active:bg-surface"}`}>
                {newSpeaker && (
                  <div className="flex items-center gap-2 mb-1">
                    <Avatar name={label(seg.speaker)} index={si} size={22} />
                    <span className={`text-[12px] font-semibold ${speakerColorClass(si)}`}>{label(seg.speaker)}</span>
                  </div>
                )}
                <div className="flex gap-3">
                  <span className={`shrink-0 w-11 text-[11px] tabular-nums pt-0.5 ${active ? "text-accent" : "text-ink-3"}`}>{hms(seg.start)}</span>
                  <p className={`text-[14.5px] leading-relaxed ${active ? "text-ink" : "text-ink-2"}`}>{seg.text}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
