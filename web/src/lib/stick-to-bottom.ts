import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD_PX = 80;

/**
 * "Follow the newest message" for a chat inside the app shell's scrolling <main>. While the reader is at (or near) the
 * bottom, every content change keeps the view pinned there; the moment they scroll up, following stops and a jump
 * button is offered; scrolling back down (or tapping the button) resumes it. `signature` should change whenever the
 * list grows or the last message streams more text.
 */
export function useStickToBottom(signature: string | number) {
  const stickRef = useRef(true);
  const [away, setAway] = useState(false);
  const container = useCallback(() => document.querySelector<HTMLElement>(".app-shell > main"), []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const main = container();
    if (!main) return;
    main.scrollTo({ top: main.scrollHeight, behavior });
  }, [container]);

  const follow = useCallback(() => {
    stickRef.current = true;
    setAway(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  useEffect(() => {
    const main = container();
    if (!main) return;
    // Only scrolls the reader started may pause following. Programmatic scrolls (our own pin, the viewport
    // self-healing nudge that sets scrollTop to 1 and back on launch) also fire scroll events and must not count.
    let userIntentUntil = 0;
    const markIntent = () => { userIntentUntil = Date.now() + 2500; };
    const onScroll = () => {
      if (Date.now() > userIntentUntil) return;
      const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < THRESHOLD_PX;
      stickRef.current = atBottom;
      setAway(!atBottom);
    };
    const intents: (keyof HTMLElementEventMap)[] = ["touchstart", "touchmove", "wheel", "pointerdown"];
    for (const ev of intents) main.addEventListener(ev, markIntent, { passive: true });
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      for (const ev of intents) main.removeEventListener(ev, markIntent);
      main.removeEventListener("scroll", onScroll);
    };
  }, [container]);

  // Content changed: keep the pin only if the reader has not moved away.
  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [signature, scrollToBottom]);

  return { away, follow, scrollToBottom };
}
