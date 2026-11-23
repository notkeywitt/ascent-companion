"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * KLOI 88.1 FM Lopez Island — the MP3 feed behind StreamGuys' own player
 * (player.streamguys.com/kloi/sgplayer/config.json).
 *
 * ONE audio element for the whole app, so the rail button and the ☰ menu row
 * show the same state and can never play two streams at once. It lives here,
 * not in a component, so it keeps playing when the menu drawer closes.
 *
 * Google Cast: the stream can also play on a Chromecast (Chromecast Audio
 * included) through Google's Default Media Receiver. The speaker fetches the
 * MP3 feed itself; the phone is only the remote. The Cast SDK runs in Chrome
 * (Android and desktop) only. Other browsers never report a device, so the
 * cast button never shows there.
 */
export const KLOI_STREAM = "https://kloi.streamguys1.com/live";
const CAST_SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

type State = {
  playing: boolean;
  failed: boolean;
  /** A Cast speaker is on the network (or one is connected). */
  castReady: boolean;
  /** The connected Cast speaker's name, while casting. */
  castDevice: string | null;
};
let state: State = { playing: false, failed: false, castReady: false, castDevice: null };
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/* ---- Google Cast (the SDK has no npm types; this is the slice we use) ---- */

type CastWindow = Window & {
  cast?: any;
  chrome?: any;
  __onGCastApiAvailable?: (ok: boolean) => void;
};
let castLoading = false;
let remotePlayer: any = null;
let remoteController: any = null;

function castContext(): any | null {
  const w = window as CastWindow;
  return w.cast?.framework?.CastContext?.getInstance() ?? null;
}

function loadCast() {
  if (castLoading || typeof window === "undefined") return;
  castLoading = true;
  const w = window as CastWindow;
  w.__onGCastApiAvailable = (ok) => {
    if (ok) initCast();
  };
  const s = document.createElement("script");
  s.src = CAST_SDK;
  s.async = true;
  document.head.appendChild(s);
}

function initCast() {
  const w = window as CastWindow;
  const fw = w.cast.framework;
  const ctx = fw.CastContext.getInstance();
  ctx.setOptions({
    receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });

  ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, (e: any) => {
    set({ castReady: e.castState !== fw.CastState.NO_DEVICES_AVAILABLE });
  });

  ctx.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, (e: any) => {
    const S = fw.SessionState;
    if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) {
      const name = e.session?.getCastDevice?.()?.friendlyName ?? "speaker";
      set({ castDevice: name, failed: false });
      // A new session: move the stream from the phone to the speaker.
      if (e.sessionState === S.SESSION_STARTED) sendToCast();
    } else if (e.sessionState === S.SESSION_ENDED) {
      set({ castDevice: null, playing: false });
    }
  });

  remotePlayer = new fw.RemotePlayer();
  remoteController = new fw.RemotePlayerController(remotePlayer);
  remoteController.addEventListener(fw.RemotePlayerEventType.PLAYER_STATE_CHANGED, () => {
    if (!state.castDevice) return;
    const ps = remotePlayer.playerState;
    set({ playing: ps === "PLAYING" || ps === "BUFFERING" });
  });
}

function sendToCast() {
  const w = window as CastWindow;
  const session = castContext()?.getCurrentSession();
  if (!session) return;
  audio?.pause();
  const media = w.chrome.cast.media;
  const info = new media.MediaInfo(KLOI_STREAM, "audio/mpeg");
  info.streamType = media.StreamType.LIVE;
  const meta = new media.MusicTrackMediaMetadata();
  meta.title = "KLOI 88.1 FM";
  meta.artist = "Lopez Island";
  info.metadata = meta;
  const req = new media.LoadRequest(info);
  req.autoplay = true;
  session.loadMedia(req).then(
    () => set({ playing: true, failed: false }),
    () => set({ playing: false, failed: true }),
  );
}

/**
 * Cast button: not casting → Chrome's speaker picker opens, and KLOI starts on
 * the speaker picked. Casting → the speaker stops and disconnects.
 */
export function castKloi() {
  const ctx = castContext();
  if (!ctx) return;
  if (state.castDevice) {
    ctx.endCurrentSession(true);
    return;
  }
  // Rejects when the picker is closed with no choice; nothing to do then.
  ctx.requestSession().catch(() => {});
}

export function toggleKloi() {
  if (state.castDevice) {
    // A live feed: stop rather than pause, and reload fresh on play.
    if (state.playing) {
      remoteController?.stop();
      set({ playing: false, failed: false });
    } else {
      sendToCast();
    }
    return;
  }
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
const server: State = { playing: false, failed: false, castReady: false, castDevice: null };

export function useKloi() {
  useEffect(loadCast, []);
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => server,
  );
}
