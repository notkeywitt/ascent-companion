"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";

// A live camera QR scanner. There is no npm-free way to decode a QR frame the way
// SignaturePad hand-rolls drawing, so this leans on jsQR (pure JS, the only decoder
// that works on iOS Safari — Safari has no BarcodeDetector). Camera access needs a
// user gesture and HTTPS; the parent gates mounting behind a "Start scanning" tap.
//
// Grabs frames from a rear-facing <video> onto an offscreen <canvas>, runs jsQR
// each animation frame, and fires onDetect once with the decoded text — then stops
// the stream so the same code isn't reported repeatedly. Releases the camera on
// unmount.

export function QrScanner({
  onDetect,
  onError,
}: {
  onDetect: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [starting, setStarting] = useState(true);

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const scan = () => {
      if (doneRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            const text = code?.data?.trim();
            if (text) {
              doneRef.current = true;
              stop();
              onDetect(text);
              return;
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(scan);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser can't access the camera.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setStarting(false);
        rafRef.current = requestAnimationFrame(scan);
      } catch (e) {
        const msg =
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and try again."
            : e instanceof Error
              ? e.message
              : "Could not start the camera.";
        if (!cancelled) onError?.(msg);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // Mount-once: onDetect/onError are read via the latest closure each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border border-neutral-300 bg-black dark:border-neutral-700">
      <video
        ref={videoRef}
        playsInline
        muted
        className="block h-auto w-full"
        style={{ aspectRatio: "4 / 3", objectFit: "cover" }}
      />
      <canvas ref={canvasRef} className="hidden" />
      {/* Framing reticle */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-48 w-48 rounded-xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.25)]" />
      </div>
      {starting && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/90">
          Starting camera…
        </div>
      )}
    </div>
  );
}
