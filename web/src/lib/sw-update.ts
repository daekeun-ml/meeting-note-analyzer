import { registerSW } from "virtual:pwa-register";

/**
 * A home-screen app is resumed far more often than it is relaunched, and a resumed page never re-registers its
 * service worker, so a deploy could sit unused for days. Check for a new worker whenever the app comes back to the
 * foreground (and every 30 minutes while open); with registerType "autoUpdate" the new worker takes control and the
 * page reloads itself, which is least disruptive right at resume time.
 */
export function installServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => { void registration.update().catch(() => undefined); };
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      window.addEventListener("pageshow", check);
      setInterval(check, 30 * 60_000);
    },
  });
}
