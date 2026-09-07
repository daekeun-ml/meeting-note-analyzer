import { useId } from "react";

/** Brand mark: gradient tile with a five-bar waveform. Same geometry as the PNG app icons (scripts/gen-icons.py). */
export function LogoMark({ size = 56, className = "" }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#7d5cff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id})`} />
      <path d="M16 28v8M24 21v22M32 14v36M40 19v26M48 27v10" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** Empty-state illustration: stacked cards with a waveform, drawn in the theme palette. */
export function EmptyIllustration({ className = "" }: { className?: string }) {
  return (
    <svg width="168" height="120" viewBox="0 0 168 120" fill="none" className={className} aria-hidden>
      <rect x="30" y="26" width="108" height="70" rx="12" fill="#172236" stroke="#2d3d5f" />
      <rect x="22" y="16" width="108" height="70" rx="12" fill="#1e2b44" stroke="#2d3d5f" />
      <path d="M44 51v8M56 43v24M68 36v38M80 41v28M92 47v16M104 44v22M116 50v10" stroke="#5b8cff" strokeWidth="4" strokeLinecap="round" />
      <circle cx="132" cy="92" r="16" fill="#5b8cff" />
      <path d="M132 85v14M125 92h14" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
