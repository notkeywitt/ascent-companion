"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";

import { assignedToolId, toolIdFromQr } from "@/lib/toolBatchRules";
import { enqueue, newId, subscribeQueue, type QueueState } from "./batchQueue";

/**
 * Batch add — catalog many tools fast on a phone. One camera stream stays open
 * the whole time, so no step waits for the camera to start:
 *
 *   Scan QR code → Take a clear picture of the tool → Take a clear picture of
 *   the serial number → Add more pictures? (Yes: one more picture, ask again.
 *   No: back to Scan QR code.)
 *
 * "Skip" on the QR step assigns a `noqr-…` id; scan the sticker into the tool's
 * Edit dialog later. Every step goes to the upload queue (batchQueue.ts) and the
 * screen moves on at once. Claude Code on the office Mac fills the details in
 * later (lib/toolBatch.ts, skill /tool-batch).
 *
 * This is a full-screen camera, not a dialog, so it does not use <Dialog>.
 */

type Step = "qr" | "tool" | "serial" | "more" | "extra";

const PROMPT: Record<Step, string> = {
  qr: "Scan QR code",
  tool: "Take a clear picture of the tool",
  serial: "Take a clear picture of the serial number",
  more: "Add more pictures?",
  extra: "Take another picture",
};

// The camera screen is always dark, whatever the app theme, so its buttons are
// white on black here rather than the theme's Button variants.
const CAM_BTN = "rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40";

const MAX_EDGE = 1600; // long edge of a saved photo, px
const QR_EDGE = 640; // long edge of the frame the QR reader looks at, px

export function BatchAdd({ knownIds, onClose }: { knownIds: Set<string>; onClose: (added: number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const qrCanvas = useRef<HTMLCanvasElement | null>(null);
  const shotCanvas = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stepRef = useRef<Step>("qr");
  const itemRef = useRef<{ id: string; toolId: string; photos: number } | null>(null);
  const seenRef = useRef<Set<string>>(new Set()); // ids saved in this batch
  const lastBadRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const [step, setStepState] = useState<Step>("qr");
  const [camErr, setCamErr] = useState("");
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [toolId, setToolId] = useState("");
  const [added, setAdded] = useState(0);
  const [flash, setFlash] = useState(false);
  const [queue, setQueue] = useState<QueueState>({ pending: 0, problem: "" });

  const setStep = (s: Step) => {
    stepRef.current = s;
    setStepState(s);
  };

  useEffect(() => subscribeQueue(setQueue), []);

  const say = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    setMsg({ text, tone });
    window.setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 2200);
  }, []);

  // ---- starting a tool ---------------------------------------------------------
  const startItem = useCallback(
    (id: string, source: "qr" | "assigned") => {
      const itemId = newId();
      itemRef.current = { id: itemId, toolId: id, photos: 0 };
      seenRef.current.add(id.toLowerCase());
      setToolId(id);
      setStep("tool");
      navigator.vibrate?.(40);
      say(source === "qr" ? `${id} saved` : `No QR — assigned ${id}`);
      void enqueue({ kind: "item", id: itemId, toolId: id, idSource: source });
    },
    [say],
  );

  const onQr = useCallback(
    (text: string) => {
      const id = toolIdFromQr(text);
      const key = id.toLowerCase();
      let bad = "";
      if (!id) bad = "That QR code holds no tool id.";
      else if (knownIds.has(key)) bad = `${id} is already on the Tools list.`;
      else if (seenRef.current.has(key)) bad = `${id} is already in this batch.`;
      if (bad) {
        // The same sticker stays in view: say so once, not every frame.
        const now = Date.now();
        if (lastBadRef.current.text !== text || now - lastBadRef.current.at > 3000) say(bad, "bad");
        lastBadRef.current = { text, at: now };
        return;
      }
      startItem(id, "qr");
    },
    [knownIds, say, startItem],
  );

  function skipQr() {
    let id = assignedToolId();
    while (knownIds.has(id) || seenRef.current.has(id)) id = assignedToolId();
    startItem(id, "assigned");
  }

  // The scan loop is set up once; it reads the latest handler through this ref.
  const onQrRef = useRef(onQr);
  onQrRef.current = onQr;

  // ---- the camera, open once for the whole batch ----------------------------
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let wake: { release: () => Promise<void> } | null = null;

    const scan = () => {
      raf = requestAnimationFrame(scan);
      if (stepRef.current !== "qr") return;
      const v = videoRef.current;
      if (!v || v.readyState < v.HAVE_ENOUGH_DATA || !v.videoWidth) return;
      const scale = Math.min(1, QR_EDGE / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.round(v.videoWidth * scale);
      const h = Math.round(v.videoHeight * scale);
      const c = (qrCanvas.current ??= document.createElement("canvas"));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      const text = code?.data?.trim();
      if (text) onQrRef.current(text);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera.");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        setReady(true);
        raf = requestAnimationFrame(scan);
        // Keep the screen awake while the batch runs. Not every browser has it.
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wake = (await nav.wakeLock?.request("screen").catch(() => null)) ?? null;
      } catch (e) {
        if (cancelled) return;
        setCamErr(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and try again."
            : e instanceof Error
              ? e.message
              : "Could not start the camera.",
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void wake?.release().catch(() => {});
    };
  }, []);

  // ---- taking a picture ---------------------------------------------------------
  function shoot(role: "tool" | "serial" | "extra", next: Step) {
    const v = videoRef.current;
    const item = itemRef.current;
    if (!v || !item || !v.videoWidth) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const c = (shotCanvas.current ??= document.createElement("canvas"));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    // The frame is copied; move on now and let the JPEG encode in the background.
    item.photos++;
    setStep(next);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
    navigator.vibrate?.(25);
    const itemId = item.id;
    c.toBlob(
      (blob) => {
        if (blob) void enqueue({ kind: "photo", itemId, id: newId(), role, blob });
      },
      "image/jpeg",
      0.85,
    );
  }

  function finishTool() {
    const item = itemRef.current;
    if (item) void enqueue({ kind: "done", id: item.id });
    itemRef.current = null;
    setAdded((n) => n + 1);
    setToolId("");
    setStep("qr");
  }

  function close() {
    const item = itemRef.current;
    let total = added;
    if (item) {
      if (item.photos > 0) {
        void enqueue({ kind: "done", id: item.id });
        total++;
      } else void enqueue({ kind: "cancel", id: item.id });
    }
    onClose(total);
  }

  const shutter = (role: "tool" | "serial" | "extra", next: Step) => (
    <button
      type="button"
      aria-label="Take picture"
      disabled={!ready}
      onClick={() => shoot(role, next)}
      className="h-20 w-20 rounded-full border-4 border-white bg-white/30 active:bg-white/70 disabled:opacity-40"
    />
  );

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      {flash && <div className="pointer-events-none absolute inset-0 bg-white/70" />}

      {/* Top: count, uploads, done */}
      <div className="relative flex items-center justify-between gap-2 bg-black/50 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="text-sm">
          <div className="font-semibold">
            {added} tool{added === 1 ? "" : "s"} this batch
          </div>
          <div className="text-xs text-white/70">
            {queue.problem || (queue.pending ? `Uploading ${queue.pending}…` : "All uploaded")}
          </div>
        </div>
        <button type="button" onClick={close} className={CAM_BTN + " bg-white text-black"}>
          Done
        </button>
      </div>

      {/* Middle: the prompt, and the QR frame */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6">
        {step === "qr" && (
          <div aria-hidden className="pointer-events-none h-56 w-56 rounded-2xl border-2 border-white/80" />
        )}
        {camErr && <p className="mt-4 rounded-lg bg-black/70 px-4 py-3 text-center text-sm">{camErr}</p>}
        {!ready && !camErr && <p className="text-sm text-white/80">Starting camera…</p>}
      </div>

      {/* Bottom: prompt + the step's controls */}
      <div className="relative bg-black/60 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
        {toolId && step !== "qr" && <p className="text-center text-xs text-white/70">{toolId}</p>}
        <p className="text-center text-lg font-semibold">{PROMPT[step]}</p>
        <p className={`h-5 text-center text-sm ${msg?.tone === "bad" ? "text-red-300" : "text-green-300"}`}>{msg?.text ?? ""}</p>

        <div className="mt-2 flex min-h-[5rem] items-center justify-center gap-6">
          {step === "qr" && (
            <button type="button" onClick={skipQr} disabled={!ready} className={CAM_BTN + " border border-white/80"}>
              Skip — no QR code
            </button>
          )}
          {step === "tool" && shutter("tool", "serial")}
          {step === "serial" && (
            <>
              <span className="w-24" />
              {shutter("serial", "more")}
              <button type="button" onClick={() => setStep("more")} className="w-24 py-3 text-sm text-white/80 underline">
                No serial
              </button>
            </>
          )}
          {step === "more" && (
            <>
              <button type="button" onClick={() => setStep("extra")} className={CAM_BTN + " min-w-[7rem] border border-white/80 py-3 text-base"}>
                Yes
              </button>
              <button type="button" onClick={finishTool} className={CAM_BTN + " min-w-[7rem] bg-white py-3 text-base text-black"}>
                No
              </button>
            </>
          )}
          {step === "extra" && shutter("extra", "more")}
        </div>
      </div>
    </div>
  );
}
