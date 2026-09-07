import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { AudioPlayerHandle } from "./AudioPlayer";
import { Button, InlineError } from "./ui";

export const VideoPlayer = forwardRef<AudioPlayerHandle, { src: string; onRefresh: () => Promise<unknown> }>(function VideoPlayer({ src, onRefresh }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const position = useRef(0); const pending = useRef<number | null>(null);
  const [error, setError] = useState(false);
  useImperativeHandle(ref, () => ({ seek(sec, play = true) {
    if (!video.current) return;
    position.current = sec;
    if (video.current.readyState >= 1) video.current.currentTime = sec;
    else pending.current = sec;
    if (play) void video.current.play().catch(() => undefined);
  } }));
  return <div className="overflow-hidden rounded-2xl border border-line bg-black">
    <video ref={video} src={src} controls playsInline preload="metadata" aria-label="강의 영상 재생" className="w-full max-h-[55vh] aspect-video"
      onTimeUpdate={(e) => { if (e.currentTarget.readyState >= 1 && pending.current === null) position.current = e.currentTarget.currentTime; }}
      onLoadedMetadata={(e) => { if (pending.current !== null) { e.currentTarget.currentTime = pending.current; pending.current = null; } setError(false); }}
      onError={() => setError(true)} />
    {error && <div className="bg-surface p-3"><InlineError>영상을 재생하지 못했습니다. 링크를 새로 불러오거나 원본을 확인하세요.</InlineError><Button variant="secondary" size="sm" className="mt-2" onClick={() => { pending.current = position.current; void onRefresh(); }}>영상 새로고침</Button><a href={src} target="_blank" rel="noreferrer" className="ml-3 text-sm text-accent">원본 영상</a></div>}
  </div>;
});
