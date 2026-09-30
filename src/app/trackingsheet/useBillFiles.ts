"use client";

import { useEffect, useRef, useState } from "react";
import type { BillFile } from "./BillCodingCard";

/**
 * The open bill's attached files (the scanned invoice) on the Tracking Sheets
 * board, from /api/bill/files. Read-only. Cached per bill for the page's life,
 * because stepping between bills is the normal motion and the file does not
 * change while you code.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * code is the board's, unchanged.
 */
export function useBillFiles({
  openDocId,
}: {
  openDocId: string | null;
}) {
  // The scanned invoice, fetched only when a bill is opened and then remembered —
  // stepping back and forth between bills is the normal motion here, and the
  // attachment doesn't change while you're coding.
  const [files, setFiles] = useState<BillFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const fileCache = useRef<Map<string, BillFile[]>>(new Map());

  useEffect(() => {
    if (!openDocId) {
      setFiles([]);
      return;
    }
    const cached = fileCache.current.get(openDocId);
    if (cached) {
      setFiles(cached);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    setFiles([]);
    fetch(`/api/bill/files?docId=${encodeURIComponent(openDocId)}`)
      .then((r) => r.json())
      .then((j) => {
        const got: BillFile[] = j.files ?? [];
        fileCache.current.set(openDocId, got);
        if (!cancelled) setFiles(got);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openDocId]);

  return {
    files,
    filesLoading,
  };
}
