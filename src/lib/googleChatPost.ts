/**
 * Post a message in a Google Chat thread on the bot's own, after the event's
 * HTTP reply is gone — how AscentBot answers a question that takes longer than
 * Google's 30-second wait.
 *
 * NO KEY FILE. The app proves who it is with Workload Identity Federation:
 * Vercel hands every request a short-lived signed token (OIDC) naming this
 * project and environment; Google's token service (STS) trades it for a Google
 * token, and that token borrows the Chat app's service account for one hour
 * with the `chat.bot` scope. Nothing long-lived is stored anywhere.
 *
 * Needs, in Vercel: OIDC Federation on (team issuer), and the env vars
 * GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
 * GCP_SERVICE_ACCOUNT_EMAIL, plus the pool's project number (GCP_PROJECT_NUMBER,
 * or GOOGLE_CHAT_PROJECT_NUMBER when the pool is in the Chat app's project). Any
 * missing → `canPostLater()` is false and the route keeps the 25-second answer.
 *
 * Server-only.
 */

const CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot";

interface Federation {
  audience: string;
  serviceAccount: string;
}

function federation(): Federation | null {
  const env = (k: string) => process.env[k]?.trim() ?? "";
  // The pool usually sits in the Chat app's own project, whose number is already set.
  const project = env("GCP_PROJECT_NUMBER") || env("GOOGLE_CHAT_PROJECT_NUMBER");
  const pool = env("GCP_WORKLOAD_IDENTITY_POOL_ID");
  const provider = env("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID");
  const serviceAccount = env("GCP_SERVICE_ACCOUNT_EMAIL");
  if (!project || !pool || !provider || !serviceAccount) return null;
  return {
    audience: `//iam.googleapis.com/projects/${project}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`,
    serviceAccount,
  };
}

/**
 * Vercel's signed token for this request: the `x-vercel-oidc-token` header on
 * a deployed function, or VERCEL_OIDC_TOKEN from `vercel env pull` locally.
 * Read it while the request is live; it lasts long enough for a later answer.
 */
export function vercelOidcToken(headers: Headers): string {
  return headers.get("x-vercel-oidc-token")?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || "";
}

export const canPostLater = (oidcToken: string) => federation() !== null && !!oidcToken;

let cached: { token: string; until: number } | null = null;

async function postJson<T>(url: string, body: unknown, bearer?: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: unknown; error_description?: string };
  if (!res.ok) {
    const why = out.error_description ?? JSON.stringify(out.error ?? res.status);
    throw new Error(`${new URL(url).hostname} answered ${res.status}: ${String(why).slice(0, 300)}`);
  }
  return out;
}

async function accessToken(fed: Federation, oidcToken: string): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  // 1. Vercel's token → a Google federated token.
  const sts = await postJson<{ access_token: string }>("https://sts.googleapis.com/v1/token", {
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: fed.audience,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    subjectToken: oidcToken,
  });
  // 2. That token borrows the Chat app's service account, for Chat only.
  const sa = await postJson<{ accessToken: string; expireTime: string }>(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(fed.serviceAccount)}:generateAccessToken`,
    { scope: [CHAT_SCOPE], lifetime: "3600s" },
    sts.access_token,
  );
  // Renewed a minute early, so a token never runs out mid-call.
  cached = { token: sa.accessToken, until: Date.parse(sa.expireTime) - 60_000 };
  return sa.accessToken;
}

/**
 * Post `text` in `thread` of `space` ("spaces/AAAA…", "spaces/AAAA…/threads/BBBB…").
 * With no thread, or a thread Chat cannot find, it starts a new one. Throws on failure.
 */
export async function postToChat(space: string, thread: string, text: string, oidcToken: string): Promise<void> {
  const fed = federation();
  if (!fed || !oidcToken) throw new Error("Workload Identity Federation is not set up.");
  if (!/^spaces\/[\w-]+$/.test(space)) throw new Error(`Not a Chat space: "${space}".`);
  const url = new URL(`https://chat.googleapis.com/v1/${space}/messages`);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  await postJson(
    url.toString(),
    { text, ...(thread ? { thread: { name: thread } } : {}) },
    await accessToken(fed, oidcToken),
  );
}
