import { SignJWT, importPKCS8 } from "jose";

/**
 * Post a message in a Google Chat thread on the bot's own, after the event's
 * HTTP reply is gone — how AscentBot answers a question that takes longer than
 * Google's 30-second wait.
 *
 * It signs in as the Chat app's service account (a robot Google login in the
 * Chat app's own Cloud project) with the `chat.bot` scope. That scope needs no
 * Workspace admin approval. The key is the env var
 * GOOGLE_CHAT_SERVICE_ACCOUNT_JSON: the whole JSON key file Google hands out.
 * Unset → `canPostLater()` is false and the route keeps the 25-second answer.
 *
 * Server-only. The key never leaves this module.
 */

const SCOPE = "https://www.googleapis.com/auth/chat.bot";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>;
    return sa.client_email && sa.private_key ? { client_email: sa.client_email, private_key: sa.private_key } : null;
  } catch {
    return null;
  }
}

export const canPostLater = () => serviceAccount() !== null;

let cached: { token: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(sa.private_key, "RS256"));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error ?? res.status}`);
  // Renewed a minute early, so a token never runs out mid-call.
  cached = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
  return body.access_token;
}

/**
 * Post `text` in `thread` of `space` ("spaces/AAAA…", "spaces/AAAA…/threads/BBBB…").
 * With no thread, or a thread Chat cannot find, it starts a new one. Throws on failure.
 */
export async function postToChat(space: string, thread: string, text: string): Promise<void> {
  const sa = serviceAccount();
  if (!sa) throw new Error("GOOGLE_CHAT_SERVICE_ACCOUNT_JSON is not set.");
  if (!/^spaces\/[\w-]+$/.test(space)) throw new Error(`Not a Chat space: "${space}".`);
  const url = new URL(`https://chat.googleapis.com/v1/${space}/messages`);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(thread ? { thread: { name: thread } } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Chat API answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
