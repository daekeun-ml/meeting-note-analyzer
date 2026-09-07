import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function make(children: ReactNode, filled = false) {
  return function Icon({ size = 20, className, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden {...rest}>
        {children}
      </svg>
    );
  };
}

export const IconMeetings = make(<><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10.5h17M8 15h5" /></>);
export const IconStudy = make(<><path d="M12 5v15M3 4.5c3-1 6-.5 9 1.5 3-2 6-2.5 9-1.5v14c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5z" /><path d="M6 8h3M15 8h3M6 12h3M15 12h3" /></>);
export const IconVideo = make(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>);
export const IconUpload = make(<><path d="M12 16V5M7 10l5-5 5 5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></>);
export const IconSettings = make(<><path d="M4 7h9M18 7h2M4 17h2M11 17h9" /><circle cx="15.5" cy="7" r="2.25" /><circle cx="8.5" cy="17" r="2.25" /></>);
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconChevronLeft = make(<path d="m15 5-7 7 7 7" />);
export const IconChevronRight = make(<path d="m9 5 7 7-7 7" />);
export const IconChevronDown = make(<path d="m5 9 7 7 7-7" />);
export const IconEdit = make(<><path d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 16v4Z" /><path d="m13 7 4 4" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconUsers = make(<><circle cx="9" cy="8" r="3.25" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.2a3.25 3.25 0 0 1 0 5.6M17 13.6a5.5 5.5 0 0 1 3.5 5.4" /></>);
export const IconSparkles = make(<><path d="m12 4 1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7-4.7-1.8 4.7-1.8z" /><path d="m19 16 .7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" /></>);
export const IconAlert = make(<><path d="M12 3.5 21 19.5H3z" /><path d="M12 10v4.5M12 17.3v.2" /></>);
export const IconBell = make(<><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IconLogOut = make(<><path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10" /><path d="m14 8 4 4-4 4M18 12H9" /></>);
export const IconFlag = make(<path d="M6 21V4h11l-1.5 4L17 12H6" />);
export const IconFileAudio = make(<><path d="M7 3h7l5 5v11.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z" /><path d="M14 3v5h5M9 17v-4M12 18v-6M15 16.5v-3" /></>);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconGlobe = make(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" /></>);
export const IconTrash = make(<path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13M10 11v6M14 11v6" />);
export const IconExternal = make(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H11" /></>);
export const IconDoc = make(<><path d="M6.5 3h8L19 7.5v12A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z" /><path d="M14 3v5h5M8.5 12h7M8.5 16h5" /></>);
export const IconListChecks = make(<><path d="m4 6.5 1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11 7h9M11 13h9M11 19h9" /></>);
export const IconNote = make(<><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v9l-5 5.5H6.5A1.5 1.5 0 0 1 5 18.5z" /><path d="M14 20v-5.5h5M8.5 9h7M8.5 12.5h4" /></>);
export const IconLightbulb = make(<><path d="M9 18h6M10 21h4" /><path d="M8 13.5A5.5 5.5 0 0 1 6.5 9.5a5.5 5.5 0 1 1 11 0A5.5 5.5 0 0 1 16 13.5c-.7.7-1 1.4-1 2.5h-6c0-1.1-.3-1.8-1-2.5z" /></>);
export const IconWaveform = make(<path d="M4 11v2M8 8v8M12 4v16M16 7v10M20 10v4" />);
export const IconPlay = make(<path d="M8 5.5v13l10-6.5z" />, true);
export const IconPause = make(<path d="M7.5 5.5h3.2v13H7.5zM13.3 5.5h3.2v13h-3.2z" />, true);
export const IconShare = make(<><path d="M12 15V4M8 8l4-4 4 4" /><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" /></>);
export const IconHome = make(<><path d="M4 11 12 4l8 7" /><path d="M6.5 10v9.5h11V10" /></>);
export const IconLanguage = make(<><path d="M4 6h9M8.5 4v2M6 18c3-2.5 5-6 5.5-12M6.5 10c1.5 3 3.5 5.5 6 8" /><path d="m13 20 3.5-8 3.5 8M14.3 17.5h4.4" /></>);

export const IconRefresh = make(<><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>);
export const IconMindMap = make(<><circle cx="12" cy="12" r="2.5" /><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M10 10.5 6.5 7.5M10 13.5l-3.5 3M14 10.5l3.5-3M14 13.5l3.5 3" /></>);

export const IconChat = make(<><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-7Z" /><path d="M8 9h8M8 12.5h5" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>);
export const IconSend = make(<><path d="M4.5 12 20 4.5 15 20l-3.5-6.5L4.5 12Z" /><path d="M11.5 13.5 20 4.5" /></>);
export const IconBrain = make(<><path d="M9 4.5A2.5 2.5 0 0 0 6.5 7v.5A2.5 2.5 0 0 0 4.5 10v1a2.5 2.5 0 0 0 1.5 2.3V14a3 3 0 0 0 3 3h.5" /><path d="M15 4.5A2.5 2.5 0 0 1 17.5 7v.5a2.5 2.5 0 0 1 2 2.5v1a2.5 2.5 0 0 1-1.5 2.3V14a3 3 0 0 1-3 3h-.5" /><path d="M12 3.5v17M9.5 20.5h5" /></>);
export const IconTool = make(<><path d="m14.5 6.5 3 3L9 18H6v-3l8.5-8.5Z" /><path d="M13 8l3 3" /></>);
export const IconQuote = make(<><path d="M6 15c-1.4 0-2.5-1.1-2.5-2.5S4.6 10 6 10c.2 0 .4 0 .5.1V9.5A3.5 3.5 0 0 1 10 6" /><path d="M15 15c-1.4 0-2.5-1.1-2.5-2.5S13.6 10 15 10c.2 0 .4 0 .5.1V9.5A3.5 3.5 0 0 1 19 6" /></>);

export function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
