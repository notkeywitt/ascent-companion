"use client";

import { useSyncExternalStore } from "react";

/**
 * KLOI 88.1 FM Lopez Island — the MP3 feed behind StreamGuys' own player
 * (player.streamguys.com/kloi/sgplayer/config.json).
 *
 * ONE audio element for the whole app, so the rail button and the ☰ menu row
 * show the same state and can never play two streams at once. It lives here,
 * not in a component, so it keeps playing when the menu drawer closes.
 */
export const KLOI_STREAM = "https://kloi.streamguys1.com/live";

type State = { playing: boolean; failed: boolean };
let state: State = { playing: false, failed: false };
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function toggleKloi() {
  if (state.playing) {
    audio?.pause();
    set({ playing: false, failed: false });
    return;
  }
  if (!audio) {
    audio = new Audio();
    audio.onerror = () => set({ playing: false, failed: true });
  }
  audio.src = KLOI_STREAM; // a live feed: reconnect fresh, never resume stale audio
  audio.play().then(
    () => set({ playing: true, failed: false }),
    () => set({ playing: false, failed: true }),
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const server: State = { playing: false, failed: false };

export function useKloi() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => server,
  );
}
