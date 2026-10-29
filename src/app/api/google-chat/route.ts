import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextRequest, NextResponse, after } from "next/server";

import type Anthropic from "@anthropic-ai/sdk";

import { readUsageByMonth } from "@/lib/aiUsage";
import { runChat } from "@/lib/anthropic";
import { getSpaceJob, recentTurns, rememberChatUser, saveTurn, type SpaceJob } from "@/lib/chatMemory";
import { getPaveConfig, hasGrant } from "@/lib/config";
import {
  answerCollector,
  BOT_TOOLS,
  CHAT_SYSTEM,
  botTools,
  buildHistory,
  canAsk,
  helpText,
  jobLine,
  looksUnanswered,
  parseEvent,
  reportGap,
  runCommand,
  todayLine,
  type BotContext,
  type GoogleChatEvent,
} from "@/lib/googleChat";
import { LONG_READ, readerTime } from "@/lib/fileReader";
import { canPostLater, canReadSpaces, postToChat, vercelOidcToken } from "@/lib/googleChatPost";
import { syncSpace } from "@/lib/chatSync";
import { getJobs } from "@/lib/jobtread";

// Google Chat posts every event in the bot's spaces here. It carries no Google
// session, so src/middleware.ts lists this path as PUBLIC and the handler
// authenticates the caller itself: a Google-signed token whose audience is this
// endpoint's URL and whose subject is Google's own account for this Chat app.
export const runtime = "nodejs";
export const maxDuration = 300;

const GOOGLE_CERTS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Google drops a reply that takes longer than 30s; answer before that. */
const DEADLINE_MS = 25_000;

/**
 * The accounts Google signs Chat events as. A classic Chat app: Chat's one
 * system account. An app built as a Workspace add-on: the add-on account of
 * OUR Cloud project, so another project's app pointed at this URL is refused.
 */
function googleSenders(): string[] {
  const project = process.env.GOOGLE_CHAT_PROJECT_NUMBER?.trim();
  return [
    "chat@system.gserviceaccount.com",
    ...(project ? [`service-${project}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`] : []),
  ];
}

type Body = { chat?: unknown; authorizationEventObject?: { systemIdToken?: string } } | null;

async function fromGoogleChat(req: NextRequest, body: Body): Promise<boolean> {
  // The URL entered as the Chat app's HTTP endpoint. Unset = refuse every event.
  const audience = process.env.GOOGLE_CHAT_AUDIENCE?.trim();
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    body?.authorizationEventObject?.systemIdToken;
  if (!audience || !token) {
    console.warn(`[google-chat] refused: ${!audience ? "GOOGLE_CHAT_AUDIENCE is not set" : "no token on the request"}`);
    return false;
  }
  try {
    const { payload } = await jwtVerify(token, GOOGLE_CERTS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
    });
    const ok = payload.email_verified === true && googleSenders().includes(String(payload.email));
    if (!ok) console.warn(`[google-chat] refused a token signed for ${payload.email}`);
    return ok;
  } catch (e) {
    console.warn(`[google-chat] bad token: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/** This month's Claude spend for the bot, against GOOGLE_CHAT_MONTHLY_USD (default $20). */
async function overMonthlyCap(): Promise<boolean> {
  const cap = Number(process.env.GOOGLE_CHAT_MONTHLY_USD ?? 20);
  const month = new Date().toISOString().slice(0, 7);
  const rows = await readUsageByMonth(1);
  const spent = rows.find((r) => r.month === month && r.feature === "google-chat")?.costUsd ?? 0;
  return spent >= cap;
}

const TOO_LONG = "That took too long to look up. Try a narrower question, or the Assistant page in the app.";
/** The wait for reading a space before a question; past it the answer goes ahead without. */
const SYNC_MS = 4_000;
const STILL_LOOKING = "Still looking. I'll post the answer in this thread when I have it.";
/** An answer posted later must land before the route's 300 s run ends. */
const LATER_MS = 270_000;

/**
 * The larger model for a hard question: rounds after the second, and a retry
 * when the small model's answer gives up. "off" keeps every round on the small one.
 */
function escalation() {
  const model = process.env.GOOGLE_CHAT_HARD_MODEL?.trim() || "claude-sonnet-5-5";
  return model === "off" ? undefined : { model, afterRounds: 2, retryIf: looksUnanswered };
}

const sleep = (ms: number) => new Promise<null>((done) => setTimeout(() => done(null), ms));

/** Claude's answer as one string. Never rejects: a failure becomes the answer's text. */
function askClaude(
  messages: Anthropic.MessageParam[],
  ctx: BotContext,
  jobContext: string,
  later: boolean,
): Promise<string> {
  const answer = answerCollector();
  const run = () =>
    runChat({
      messages,
      jobId: ctx.job?.jobId,
      model: process.env.GOOGLE_CHAT_MODEL?.trim() || "claude-haiku-5-5",
      feature: "google-chat",
      extraSystem: `${CHAT_SYSTEM}\n\n${jobContext}`,
      tools: BOT_TOOLS,
      extraTools: botTools(ctx),
      escalate: escalation(),
      onEvent: answer.onEvent,
    });
  // With a way to answer later, the file reader may take longer over a long scan.
  return (later ? readerTime.run(LONG_READ, run) : run()).then(
    () => answer.text() || "I couldn't find an answer to that.",
    (e) => {
      console.error(`[google-chat] answer failed: ${e instanceof Error ? e.message : e}`);
      return "Something went wrong looking that up. Try again, or use the Assistant page in the app.";
    },
  );
}

/** Memory is best-effort: a failed read or write is logged, never fails the reply. */
async function quietly<T>(what: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error(`[google-chat] ${what} failed: ${e instanceof Error ? e.message : e}`);
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body;
  if (!(await fromGoogleChat(req, body))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // An add-on app takes its reply wrapped in a create-message action.
  const reply = (text: string) =>
    NextResponse.json(
      body?.chat
        ? { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } } }
        : { text },
    );

  const ask = parseEvent(body as GoogleChatEvent);
  console.log(`[google-chat] ${ask.kind}${"email" in ask ? ` from ${ask.email}` : ""}`);
  if (ask.kind === "ignore") return NextResponse.json({});
  if (ask.kind === "added") return reply(helpText());

  // Learn the asker's name, so messages read from the space can say who wrote them.
  await quietly("remembering the asker", rememberChatUser(ask.user, ask.name, ask.email), undefined);

  if (!canAsk(ask.email)) {
    return reply("Sorry, I only answer the pilot group for now. Ask the office to add you.");
  }
  if (!hasGrant()) return reply("I can't reach JobTread right now (JT_GRANT_KEY is not set).");

  try {
    const cfg = getPaveConfig();
    const linked = await quietly<SpaceJob | null>("reading the space's job", getSpaceJob(ask.space), null);
    if (ask.kind === "command") return reply(await runCommand(cfg, ask.commandId, ask.arg, linked));

    if (/^(help|\?)$/i.test(ask.text)) return reply(helpText());
    if (!process.env.ANTHROPIC_API_KEY) return reply("AI answers are off for now. Ask the office.");
    if (await overMonthlyCap()) return reply("This month's AI budget for chat is used up. Ask the office.");

    // Read while the request is live: Google sign-ins below and the later answer use it.
    const oidc = vercelOidcToken(req.headers);
    const later = canPostLater(oidc);
    // Hear the space first, so what people said since the last read is in the history.
    if (linked && canReadSpaces(oidc)) {
      const got = await quietly(
        "reading the space",
        Promise.race([syncSpace(ask.space, linked.jobId, oidc, 2), sleep(SYNC_MS).then(() => -1)]),
        0,
      );
      if (got === -1) console.warn("[google-chat] reading the space ran past its wait; answering without it");
    }

    const [turns, jobs] = await Promise.all([
      quietly("reading the space's history", recentTurns(ask.space), []),
      linked ? getJobs(cfg) : Promise.resolve([]),
    ]);
    const ctx: BotContext = { cfg, space: ask.space, thread: ask.thread, email: ask.email, name: ask.name, job: linked };
    const jobContext = `${todayLine()}\n${jobLine(
      jobs.find((j) => j.id === linked?.jobId),
      linked,
    )}`;
    // Saved first, so a decision kept during the answer files after the question that carried it.
    const where = { space: ask.space, thread: ask.thread };
    await quietly(
      "saving the question",
      saveTurn({ ...where, jobId: linked?.jobId ?? "", kind: "question", author: ask.name, text: ask.text }),
      undefined,
    );
    const start = Date.now();
    const answer = askClaude(buildHistory(turns, { name: ask.name, text: ask.text }), ctx, jobContext, later);
    // ctx.job, not `linked`: the answer may have just tied the space to a job.
    const keep = async (text: string) => {
      await quietly(
        "saving the answer",
        saveTurn({ ...where, jobId: ctx.job?.jobId ?? "", kind: "answer", author: "", text }),
        undefined,
      );
      // Claude skips report_gap at times, so a "found nothing" answer emails the office here.
      if (!ctx.gapReported && looksUnanswered(text)) {
        const sent = await reportGap(ctx, ask.text, `AscentBot did not report this itself. Its answer:\n${text}`);
        console.log(`[google-chat] fallback report_gap: ${sent ? "sent" : "failed"}`);
      }
    };

    const quick = await Promise.race([answer, sleep(DEADLINE_MS)]);
    if (quick !== null) {
      // After the reply: Google stops waiting at 30s.
      after(() => keep(quick));
      return reply(quick);
    }
    // The [chat:google-chat] lines before this one show which round or tool was slow.
    console.warn(`[google-chat] deadline hit after ${Date.now() - start}ms: ${ask.text.slice(0, 200)}`);
    if (!later) return reply(TOO_LONG);

    // Answer later: the reply says so now, and the answer is posted in the thread.
    after(async () => {
      const late = await Promise.race([answer, sleep(LATER_MS - (Date.now() - start))]);
      try {
        await postToChat(ask.space, ask.thread, late ?? TOO_LONG, oidc);
        console.log(`[google-chat] posted a later answer after ${Date.now() - start}ms`);
      } catch (e) {
        console.error(`[google-chat] posting the later answer failed: ${e instanceof Error ? e.message : e}`);
      }
      if (late !== null) await keep(late);
    });
    return reply(STILL_LOOKING);
  } catch (e) {
    console.error(`[google-chat] ${e instanceof Error ? e.message : e}`);
    return reply("Something went wrong looking that up. Try again, or use the Assistant page in the app.");
  }
}
