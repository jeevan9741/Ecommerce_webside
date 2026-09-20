"use client";

import { useEffect } from "react";

/** Registers the PWA service worker (public/sw.js) so the site can be installed
 * as an app on Android/iOS/desktop. Runs once on mount, client-side only. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    }
  }, []);

  return null;
}
