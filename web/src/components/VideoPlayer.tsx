import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { hms, type AudioPlayerHandle } from "./AudioPlayer";
import { IconPause, IconPlay } from "./icons";
import { Button, InlineError } from "./ui";

interface VideoPlayerProps {
  src: string;
  onRefresh: () => Promise<unknown>;
  /** Mini-player layout (small picture, time, play/pause, expand); the same <video> keeps playing across the switch. */
  compact?: boolean;
  title?: string;
  onPlayingChange?: (playing: boolean) => void;
  onExpand?: () => void;
}

export const VideoPlayer = forwardRef<AudioPlayerHandle, VideoPlayerProps>(function VideoPlayer({ src, onRefresh, compact = false, title, onPlayingChange, onExpand }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const position = useRef(0); const pending = useRef<number | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false); const [time, setTime] = useState(0); const [duration, setDuration] = useState(0);
  const setPlay = (next: boolean) => { setPlaying(next); onPlayingChange?.(next); };
  useImperativeHandle(ref, () => ({ seek(sec, play = true) {
    if (!video.current) return;
    position.current = sec;
    if (video.current.readyState >= 1) video.current.currentTime = sec;
    else pending.current = sec;
    if (play) void video.current.play().catch(() => undefined);
  } }));
  return <div className={compact ? "flex items-center gap-3 rounded-xl border border-line bg-black px-2 py-2" : "overflow-hidden rounded-2xl border border-line bg-black"}>
    <video ref={video} src={src} controls={!compact} playsInline preload="metadata" aria-label="강의 영상 재생" className={compact ? "w-28 shrink-0 rounded-lg aspect-video object-cover" : "w-full max-h-[55vh] aspect-video"}
      onPlay={() => setPlay(true)} onPause={() => setPlay(false)} onEnded={() => setPlay(false)}
      onTimeUpdate={(e) => { if (e.currentTarget.readyState >= 1 && pending.current === null) position.current = e.currentTarget.currentTime; setTime(e.currentTarget.currentTime); }}
      onLoadedMetadata={(e) => { if (pending.current !== null) { e.currentTarget.currentTime = pending.current; pending.current = null; } setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0); setError(false); }}
      onError={() => setError(true)} />
    {compact && <>
      <div className="min-w-0 flex-1 text-white"><p className="truncate text-[13px] font-medium">{title || "강의 영상"}</p><p className="text-[11px] tabular-nums text-white/70">{hms(time)} / {hms(duration)}</p></div>
      <button type="button" aria-label={playing ? "일시정지" : "재생"} className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white" onClick={() => { const v = video.current; if (!v) return; if (playing) v.pause(); else void v.play().catch(() => undefined); }}>{playing ? <IconPause size={18} /> : <IconPlay size={18} className="ml-0.5" />}</button>
      <button type="button" className="tap shrink-0 px-2 py-2 text-[12px] text-white/80" onClick={onExpand}>펼치기</button>
    </>}
    {error && <div className="bg-surface p-3"><InlineError>영상을 재생하지 못했습니다. 링크를 새로 불러오거나 원본을 확인하세요.</InlineError><Button variant="secondary" size="sm" className="mt-2" onClick={() => { pending.current = position.current; void onRefresh(); }}>영상 새로고침</Button><a href={src} target="_blank" rel="noreferrer" className="ml-3 text-sm text-accent">원본 영상</a></div>}
  </div>;
});
