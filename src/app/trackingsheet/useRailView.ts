"use client";

import { useEffect, useState } from "react";

/** Where a device remembers whether the budget column is closed. */
const RAIL_HIDDEN_KEY = "ts.railHidden";

/**
 * The budget column's own screen state on the Tracking Sheets board: the code
 * search, folded divisions, the phone fold, the desk hide (remembered per
 * device) and which end of the phone's cards leads. Display only — nothing
 * here touches money or JobTread. Moved out of Board.tsx on 2026-09-29
 * (SIMPLICITY_AUDIT.md finding 01); the code is the board's, unchanged.
 */
export function useRailView() {
  const [codeQuery, setCodeQuery] = useState("");
  // Divisions the user has rolled up. Empty = all open, so the rail keeps
  // showing every code until it's deliberately tidied.
  const [collapsedDivs, setCollapsedDivs] = useState<Set<string>>(new Set());
  // Mobile-only: roll the whole cost-code rail away. On a phone it stacks on
  // top of the bills, so it starts collapsed to land you on the list — tap the
  // header to open it. The desktop sidebar ignores this (it's always docked,
  // via the `lg:` overrides), so defaulting to collapsed is a mobile-only cost.
  const [railCollapsed, setRailCollapsed] = useState(true);
  /**
   * …and the DESKTOP fold, which is a different thing: `railCollapsed` folds
   * the cards away on a phone, this closes the rail's whole COLUMN so the bills
   * take the width. Remembered per device — someone who codes with the rail
   * shut wants it shut tomorrow too. Read in an effect rather than at init, so
   * the server and the first client render agree.
   */
  const [railHidden, setRailHidden] = useState(false);
  useEffect(() => {
    try {
      setRailHidden(localStorage.getItem(RAIL_HIDDEN_KEY) === "1");
    } catch {
      /* blocked storage just means the rail opens shown */
    }
  }, []);
  const toggleRailHidden = () =>
    setRailHidden((v) => {
      try {
        localStorage.setItem(RAIL_HIDDEN_KEY, v ? "0" : "1");
      } catch {
        /* per-session then */
      }
      return !v;
    });
  /** Which end of the phone's headroom cards leads. They fold with the rail. */
  const [headroomMostLeft, setHeadroomMostLeft] = useState(false);

  return {
    codeQuery,
    setCodeQuery,
    collapsedDivs,
    setCollapsedDivs,
    railCollapsed,
    setRailCollapsed,
    railHidden,
    toggleRailHidden,
    headroomMostLeft,
    setHeadroomMostLeft,
  };
}
