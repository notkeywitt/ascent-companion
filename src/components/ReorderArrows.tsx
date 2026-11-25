"use client";

import { IconButton } from "@/components/ui";

/** Up and down buttons that move one card or section one place. */
export function ReorderArrows({
  onUp,
  onDown,
  first,
  last,
}: {
  onUp: () => void;
  onDown: () => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <span className="flex items-center">
      <IconButton label="Move up" disabled={first} onClick={onUp}>
        ↑
      </IconButton>
      <IconButton label="Move down" disabled={last} onClick={onDown}>
        ↓
      </IconButton>
    </span>
  );
}
