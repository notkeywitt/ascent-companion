import { describe, expect, it } from "vitest";

import { applyDismissals, dismissalKey, todoIdFromKey, todoItemKey } from "./dismissals";
import type { StoredCheckResult } from "./types";

/**
 * The dismissal contract: an item's identity has to survive a re-run (or the
 * digest un-dismisses itself every morning), and taking items out has to leave
 * the check reading honestly rather than keeping a summary written over the
 * un-filtered list.
 */

const result = (over: Partial<StoredCheckResult> = {}): StoredCheckResult => ({
  id: "email-followups",
  title: "Waiting on a Reply",
  category: "followup",
  status: "warning",
  summary: "2 conversations waiting on a reply.",
  items: [],
  durationMs: 1,
  ...over,
});

describe("dismissalKey", () => {
  it("namespaces the check's own key by check id", () => {
    expect(dismissalKey("jobtread-todos", { title: "Order the windows", key: "task:22" })).toBe(
      "jobtread-todos::task:22",
    );
  });

  it("keeps two checks that share an item key apart", () => {
    const a = dismissalKey("email-followups", { title: "x", key: "thread:1" });
    const b = dismissalKey("email-signals", { title: "x", key: "thread:1" });
    expect(a).not.toBe(b);
  });

  it("falls back to the title, ignoring case and spacing", () => {
    const a = dismissalKey("digest-todos", { title: "Call  the INSPECTOR " });
    const b = dismissalKey("digest-todos", { title: "call the inspector" });
    expect(a).toBe(b);
    expect(a).toContain("title:");
  });
});

describe("applyDismissals", () => {
  const dismissed = new Set(["email-followups::thread:1"]);

  it("drops only the dismissed item", () => {
    const [r] = applyDismissals(
      [result({ items: [{ title: "A", key: "thread:1" }, { title: "B", key: "thread:2" }] })],
      dismissed,
    );
    expect(r.items.map((i) => i.title)).toEqual(["B"]);
    expect(r.summary).toContain("1 item dismissed");
  });

  it("reads as clear, not as a warning, once everything is dismissed", () => {
    const [r] = applyDismissals([result({ items: [{ title: "A", key: "thread:1" }] })], dismissed);
    expect(r.items).toEqual([]);
    expect(r.status).toBe("ok");
    expect(r.summary).toBe("All clear — 1 item dismissed.");
  });

  it("leaves a check with no dismissed items exactly as it was", () => {
    const input = [result({ items: [{ title: "B", key: "thread:2" }] })];
    expect(applyDismissals(input, dismissed)[0]).toBe(input[0]);
    expect(applyDismissals(input, new Set())).toBe(input);
  });

  it("does not touch an errored check's status", () => {
    const [r] = applyDismissals(
      [result({ status: "error", items: [{ title: "A", key: "thread:1" }] })],
      dismissed,
    );
    expect(r.status).toBe("error");
  });
});

describe("digest-todos keys", () => {
  it("round-trips a reminder id, so dismissing one marks it done", () => {
    const key = dismissalKey("digest-todos", { title: "anything", key: todoItemKey(12) });
    expect(todoIdFromKey(key)).toBe(12);
  });

  it("reads no reminder id out of another check's key", () => {
    expect(todoIdFromKey("jobtread-todos::task:12")).toBeNull();
    expect(todoIdFromKey("digest-todos::title:something")).toBeNull();
  });
});
