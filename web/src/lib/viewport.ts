/**
 * Viewport diagnostics and self-healing for iOS home-screen (standalone) web apps.
 *
 * iOS lays out the first frame of a standalone app against a viewport that does not yet match the screen and only
 * recomputes it after the first touch scroll. We keep --app-height equal to the measured viewport, re-measure on
 * every signal we can get (resize, visualViewport, pageshow, timers), reset any spurious document scroll offset, and
 * nudge the inner scroller once so WebKit performs the same recomputation a user scroll would. Every measurement is
 * kept in `samples` and shown under 설정 > 진단 정보 so a device screenshot tells us what the browser actually saw.
 */
export interface ViewportSample {
  t: number;
  source: string;
  innerHeight: number;
  visualHeight: number | null;
  visualOffsetTop: number | null;
  screenHeight: number;
  scrollY: number;
  mainScrollTop: number | null;
  appHeight: string;
  shellHeight: number | null;
  navBottom: number | null;
}

export const samples: ViewportSample[] = [];
const started = performance.now();

export function safeAreaInsets(): { top: number; bottom: number } {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return out;
}

export function isStandaloneDisplay(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function measure(source: string): ViewportSample {
  const main = document.querySelector<HTMLElement>(".app-shell > main");
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const nav = document.querySelector<HTMLElement>("nav");
  const sample: ViewportSample = {
    t: Math.round(performance.now() - started),
    source: editing ? `${source}+editing` : source,
    innerHeight: window.innerHeight,
    visualHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    visualOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    screenHeight: window.screen.height,
    scrollY: Math.round(window.scrollY),
    mainScrollTop: main ? Math.round(main.scrollTop) : null,
    appHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim(),
    shellHeight: shell ? Math.round(shell.getBoundingClientRect().height) : null,
    navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
  };
  samples.push(sample);
  if (samples.length > 60) samples.splice(0, samples.length - 60);
  return sample;
}

/**
 * Best estimate of the real viewport height. On first launch a standalone iOS app reports innerHeight short by the
 * status bar and home indicator (device screenshot: a blank strip under the tab bar until the first scroll). With a
 * translucent status bar the web view covers the whole screen, so screen.height is the truth in portrait.
 */
function expectedHeight(): number {
  let h = Math.max(Math.round(window.innerHeight), Math.round(window.visualViewport?.height ?? 0));
  if (isStandaloneDisplay() && window.matchMedia("(orientation: portrait)").matches && document.body) {
    const fullScreenWebView = safeAreaInsets().top > 0;
    if (fullScreenWebView && window.screen.height > h) h = window.screen.height;
  }
  return h;
}

/**
 * Height of the on-screen keyboard, if any. iOS keeps innerHeight at the full layout viewport while the keyboard is
 * up and only the visual viewport shrinks; a sticky composer at the bottom of the shell would then sit under the keys.
 */
export function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  // offsetTop is the page scroll iOS applies to reveal the field, not keyboard height: subtracting it hid the keyboard entirely.
  const inset = Math.round(window.innerHeight - vv.height);
  return inset > 120 ? inset : 0;
}

/** True while a text field has focus: the on-screen keyboard is (about to be) up. */
let editing = false;

const isEditable = (el: EventTarget | null): el is HTMLElement => el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);

export function syncAppHeight(source = "sync"): void {
  const kb = keyboardInset();
  const h = kb > 0 && window.visualViewport ? Math.round(window.visualViewport.height) : expectedHeight();
  if (h > 0) document.documentElement.style.setProperty("--app-height", `${h}px`);
  document.documentElement.toggleAttribute("data-keyboard", kb > 0 || editing);
  // With the shell sized to the visual viewport the composer already clears the keyboard; undo any page scroll iOS added.
  if (kb > 0 && window.scrollY !== 0) window.scrollTo(0, 0);
  measure(source);
}

/**
 * Keyboard handling has two cases. Safari shrinks the visual viewport (handled by keyboardInset above). A home-screen
 * app keeps the viewport and instead scrolls the document so the focused field clears the keyboard; the window scroll
 * reset below must not fight that, and we pull the field into view ourselves once the keyboard has animated in.
 */
function installKeyboardTracking(): void {
  document.addEventListener("focusin", (e) => {
    if (!isEditable(e.target)) return;
    editing = true;
    const field = e.target;
    syncAppHeight("focusin");
    setTimeout(() => {
      syncAppHeight("focusin+400");
      if (document.activeElement === field) field.scrollIntoView({ block: "end", behavior: "smooth" });
    }, 400);
  });
  document.addEventListener("focusout", (e) => {
    if (!isEditable(e.target)) return;
    editing = false;
    setTimeout(() => {
      if (!editing) {
        window.scrollTo(0, 0);
        syncAppHeight("focusout");
      }
    }, 150);
  });
}

/** Make the document 2px scrollable for one frame and scroll it: the scroll is what makes iOS refresh its viewport. */
function nudgeDocumentScroll(): void {
  const root = document.documentElement;
  const prev = root.style.minHeight;
  root.style.minHeight = "calc(100% + 2px)";
  window.scrollTo(0, 1);
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    root.style.minHeight = prev;
    syncAppHeight("nudge");
  });
}

function nudgeInnerScroller(): void {
  const main = document.querySelector<HTMLElement>(".app-shell > main");
  if (main) {
    // Keep the reader's position: the chat pins itself to the newest message and this must not undo that.
    const prev = main.scrollTop;
    main.scrollTop = prev + 1;
    main.scrollTop = prev;
  }
  nudgeDocumentScroll();
}

export function installViewportSync(): void {
  syncAppHeight("load");
  window.addEventListener("resize", () => syncAppHeight("resize"));
  window.visualViewport?.addEventListener("resize", () => syncAppHeight("visualViewport.resize"));
  window.visualViewport?.addEventListener("scroll", () => syncAppHeight("visualViewport.scroll"));
  window.addEventListener("orientationchange", () => setTimeout(() => syncAppHeight("orientationchange"), 300));
  window.addEventListener("pageshow", () => syncAppHeight("pageshow"));
  window.addEventListener("focus", () => syncAppHeight("focus"));
  // A standalone app must never end up with the document itself scrolled; the inner <main> is the only scroller.
  // Only while a field is focused and the visual viewport has not (yet) shrunk may iOS keep its own scroll: that is the
  // one way the field can be revealed. Once the viewport shrinks, syncAppHeight resets the scroll again.
  window.addEventListener("scroll", () => { measure("window.scroll"); if (window.scrollY !== 0 && !(editing && keyboardInset() === 0)) window.scrollTo(0, 0); }, { passive: true });
  installKeyboardTracking();
  for (const ms of [50, 250, 600, 1200, 2500, 5000]) setTimeout(() => { nudgeInnerScroller(); syncAppHeight(`timer:${ms}`); }, ms);
  requestAnimationFrame(() => { nudgeInnerScroller(); syncAppHeight("raf"); });
}
