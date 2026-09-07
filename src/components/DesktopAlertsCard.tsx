"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, Card, MetaLine, SectionHeading } from "@/components/ui";
import {
  disableToasts,
  enableToasts,
  showToast,
  toastState,
  toastsSupported,
  type ToastState,
} from "@/lib/noticeToasts";

/**
 * Desktop alerts — the per-device switch for OS notifications about notices.
 *
 * SELF-HIDING: renders nothing where the browser has no Notification API,
 * which is every iPhone and iPad (Safari needs a service worker and a push
 * subscription even inside an installed app). So this appears on computers and
 * on Android, and a phone in the field never sees a control it can't use.
 *
 * Per device, in localStorage, exactly like the theme and the palette next to
 * it — the office desktop can be armed while the same person's phone is not,
 * and nothing is written to the account.
 *
 * It sits on the home page because that is the one screen every role lands on,
 * and it starts COLLAPSED: this is set once and then left alone. The heading
 * still says the state when closed, so the card answers "am I getting these?"
 * without being opened.
 *
 * Alerts only fire while the Assistant is OPEN in a tab or the side panel, and
 * only for a notice that arrives while it is in the background. Nothing
 * arrives when the app is closed — the card says so, because a promise the
 * browser can't keep is worse than no alert at all.
 */

const EXPANDED_KEY = "desktopAlerts.expanded";

const STATE_LABEL: Record<ToastState, string> = {
  unsupported: "Not available",
  off: "Off",
  ask: "Off",
  blocked: "Blocked by the browser",
  on: "On",
};

export function DesktopAlertsCard() {
  // `null` until the first effect runs: the server cannot know a localStorage
  // value or a permission, and rendering a guess would be a hydration mismatch.
  const [state, setState] = useState<ToastState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    setState(toastState());
    try {
      if (localStorage.getItem(EXPANDED_KEY) === "1") setOpen(true);
    } catch {
      /* storage unavailable — stay collapsed */
    }
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
      } catch {
        /* the choice just won't persist */
      }
      return next;
    });
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      // Must run straight out of the click — the browser refuses the prompt
      // otherwise.
      setState(await enableToasts());
    } finally {
      setBusy(false);
    }
  }

  function turnOff() {
    disableToasts();
    setTested(false);
    setState(toastState());
  }

  // Nothing to offer where the API doesn't exist, and nothing to say before the
  // first effect has read the device.
  if (state === null || !toastsSupported() || state === "unsupported") return null;

  const on = state === "on";

  return (
    <section className="mt-8 text-left">
      <SectionHeading
        onToggle={toggleOpen}
        open={open}
        trailing={open ? undefined : <MetaLine items={[STATE_LABEL[state]]} />}
      >
        Desktop alerts
      </SectionHeading>
      {open && (
        <Card className="mt-3">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Pop a notice up in the corner of this computer&rsquo;s screen when it arrives while
            the Assistant is open in another tab. Only on this device.
          </p>
          <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            Nothing arrives when the app is closed, and nothing repeats what is already on
            screen — a notice you are looking at stays a banner.
          </p>

          {state === "blocked" && (
            <p className="mt-2.5 text-xs text-amber-700 dark:text-amber-300">
              This browser is blocking notifications for the app. Turn them back on in the
              browser&rsquo;s site settings (the icon at the left of the address bar), then come
              back here.
            </p>
          )}
          {state === "ask" && (
            <p className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">
              The browser has not been asked yet. Use the button below.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {on ? (
              <>
                <Button variant="secondary" onClick={turnOff}>
                  Turn off
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setTested(showToast({ id: "test", title: "Ascent Assistant", body: "Desktop alerts are working." }))}
                >
                  Send a test
                </Button>
                {tested && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    Sent — check the corner of your screen.
                  </span>
                )}
              </>
            ) : (
              <Button onClick={turnOn} disabled={busy || state === "blocked"}>
                {busy ? "Asking…" : "Turn on"}
              </Button>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}
