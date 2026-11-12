import { callAppsScriptResponse } from "@/lib/appsScript";

// "Check for Bills": runs the Apps Script `_JT Invoice ...` Gmail scan now instead of
// waiting for its 15-minute trigger. Each tagged email becomes a draft bill. A write,
// so appsScript.ts never retries it (the action is not a get/list).
export const maxDuration = 300;

export async function POST() {
  return callAppsScriptResponse({ action: "scanInvoiceTags" }, { timeoutMs: 280_000 });
}
