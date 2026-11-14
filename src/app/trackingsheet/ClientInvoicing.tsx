"use client";

import { Board } from "./Board";

/**
 * /trackingsheet is the Jobs Hub now: a link with `?jobId=` and one without
 * both redirect there (next.config.mjs). This keeps the standalone board
 * mounted for the route until the page itself is removed.
 */
export function ClientInvoicing() {
  return <Board />;
}
