import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canPostLater, postToChat } from "./googleChatPost";

afterEach(() => {
  delete process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON;
  vi.unstubAllGlobals();
});

describe("canPostLater", () => {
  it("needs a whole service account key", () => {
    expect(canPostLater()).toBe(false);
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON = "{not json";
    expect(canPostLater()).toBe(false);
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "bot@x.iam.gserviceaccount.com" });
    expect(canPostLater()).toBe(false);
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "bot@x", private_key: "k" });
    expect(canPostLater()).toBe(true);
  });
});

describe("postToChat", () => {
  it("signs in, then posts in the asker's thread", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "bot@x.iam.gserviceaccount.com",
      private_key: await exportPKCS8(privateKey),
    });
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return String(url).includes("oauth2")
          ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }))
          : new Response("{}");
      }),
    );
    await postToChat("spaces/AAA", "spaces/AAA/threads/BBB", "Charcoal Grey");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[1].url).toBe(
      "https://chat.googleapis.com/v1/spaces/AAA/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
    );
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ text: "Charcoal Grey", thread: { name: "spaces/AAA/threads/BBB" } });
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("refuses anything that is not a space", async () => {
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "a", private_key: "k" });
    await expect(postToChat("https://evil", "", "x")).rejects.toThrow(/Not a Chat space/);
  });
});
