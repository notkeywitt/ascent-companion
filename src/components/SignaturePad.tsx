"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// A drawn-signature canvas. Hand-rolled pointer handling (no npm dep) — works
// for touch, Apple Pencil, and mouse. Sized to its CSS box at devicePixelRatio
// so lines stay crisp on retina/iPad. Exposes an imperative handle so the parent
// can read the PNG on "Add" and clear for the next signer.

export interface SignaturePadHandle {
  /** PNG data URL, or null if nothing has been drawn. */
  toDataURL: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
}

export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { height?: number; className?: string; onChange?: (empty: boolean) => void }
>(function SignaturePad({ height = 180, className = "", onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Match the backing store to the CSS box at DPR. Assigning width/height resets
  // the context transform to identity, so re-applying scale() each time is safe
  // (never compounds).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = "#111827";
      }
      dirty.current = false;
      onChange?.(true);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // onChange intentionally excluded — a stable-enough callback; re-running
    // resize on every parent render would wipe an in-progress signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFrom(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointFrom(e);
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!dirty.current) {
      dirty.current = true;
      onChange?.(false);
    }
  }

  function up() {
    drawing.current = false;
    last.current = null;
  }

  useImperativeHandle(ref, () => ({
    toDataURL: () =>
      dirty.current ? canvasRef.current?.toDataURL("image/png") ?? null : null,
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty.current = false;
      onChange?.(true);
    },
    isEmpty: () => !dirty.current,
  }));

  return (
    <canvas
      ref={canvasRef}
      style={{ height, touchAction: "none" }}
      className={
        "w-full rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 " +
        className
      }
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    />
  );
});
