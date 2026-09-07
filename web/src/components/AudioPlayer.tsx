import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { IconPause, IconPlay } from "./icons";

export interface AudioPlayerHandle {
  seek: (sec: number, play?: boolean) => void;
}

export function hms(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:` : "") + `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, { src: string; onTime?: (sec: number) => void; onError?: () => void }>(function AudioPlayer({ src, onTime, onError }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    seek(sec, play = true) {
      const a = audio.current;
      if (!a) return;
      a.currentTime = sec;
      if (play) void a.play().catch(() => undefined);
    },
  }));

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };
  const pct = duration ? (current / duration) * 100 : 0;

  return (
    <div className="rounded-2xl bg-surface-2 border border-line p-3 flex items-center gap-3">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration || 0); setReady(true); }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => { setCurrent(e.currentTarget.currentTime); onTime?.(e.currentTarget.currentTime); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={onError}
      />
      <button onClick={toggle} aria-label={playing ? "일시정지" : "재생"} className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white shadow-glow active:scale-95 transition-transform">
        {playing ? <IconPause size={20} /> : <IconPlay size={20} className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <input
          type="range"
          className="seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          style={{ ["--p" as string]: `${pct}%` }}
          onChange={(e) => { const v = Number(e.target.value); setCurrent(v); if (audio.current) audio.current.currentTime = v; }}
          aria-label="재생 위치"
        />
        <div className="flex justify-between text-[11px] text-ink-3 tabular-nums -mt-1">
          <span>{hms(current)}</span>
          <span>{ready ? hms(duration) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
});
