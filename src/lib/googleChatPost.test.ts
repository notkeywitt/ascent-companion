import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canPostLater, postToChat, vercelOidcToken } from "./googleChatPost";

const ENV = {
  GOOGLE_CHAT_PROJECT_NUMBER: "123",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel-oidc",
  GCP_SERVICE_ACCOUNT_EMAIL: "ascentbot@proj.iam.gserviceaccount.com",
};

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  for (const k of [...Object.keys(ENV), "GCP_PROJECT_NUMBER", "VERCEL_OIDC_TOKEN"]) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("canPostLater", () => {
  it("needs the federation settings and Vercel's token", () => {
    expect(canPostLater("tok")).toBe(true);
    expect(canPostLater("")).toBe(false);
    delete process.env.GCP_SERVICE_ACCOUNT_EMAIL;
    expect(canPostLater("tok")).toBe(false);
  });

  it("reads Vercel's token from the request, then the environment", () => {
    expect(vercelOidcToken(new Headers({ "x-vercel-oidc-token": "h" }))).toBe("h");
    process.env.VERCEL_OIDC_TOKEN = "e";
    expect(vercelOidcToken(new Headers())).toBe("e");
  });
});

describe("postToChat", () => {
  it("trades Vercel's token for the service account's, then posts in the thread", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.startsWith("https://sts.")) return new Response(JSON.stringify({ access_token: "fed" }));
        if (url.startsWith("https://iamcredentials."))
          return new Response(JSON.stringify({ accessToken: "sa", expireTime: new Date(Date.now() + 3.6e6).toISOString() }));
        return new Response("{}");
      }),
    );
    await postToChat("spaces/AAA", "spaces/AAA/threads/BBB", "Charcoal Grey", "vercel-jwt");

    const sts = JSON.parse(String(calls[0].init.body));
    expect(sts).toMatchObject({
      audience: "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/vercel/providers/vercel-oidc",
      subjectToken: "vercel-jwt",
    });
    expect(calls[1].url).toBe(
      "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/ascentbot%40proj.iam.gserviceaccount.com:generateAccessToken",
    );
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer fed");
    expect(JSON.parse(String(calls[1].init.body)).scope).toEqual(["https://www.googleapis.com/auth/chat.bot"]);
    expect(calls[2].url).toBe(
      "https://chat.googleapis.com/v1/spaces/AAA/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
    );
    expect((calls[2].init.headers as Record<string, string>).Authorization).toBe("Bearer sa");
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ text: "Charcoal Grey", thread: { name: "spaces/AAA/threads/BBB" } });
  });

  it("refuses anything that is not a space", async () => {
    await expect(postToChat("https://evil", "", "x", "tok")).rejects.toThrow(/Not a Chat space/);
  });
});
