import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

import { readUsageByMonth } from "@/lib/aiUsage";
import { runChat } from "@/lib/anthropic";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { CHAT_SYSTEM, canAsk, helpText, parseEvent, runCommand } from "@/lib/googleChat";

// Google Chat posts every event in the bot's spaces here. It carries no Google
// session, so src/middleware.ts lists this path as PUBLIC and the handler
// authenticates the caller itself: a Google-signed token whose audience is this
// endpoint's URL and whose subject is Google Chat's own service account.
export const runtime = "nodejs";
export const maxDuration = 60;

const GOOGLE_CERTS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const CHAT_ISSUER = "chat@system.gserviceaccount.com";

/** Google drops a reply that takes longer than 30s; answer before that. */
const DEADLINE_MS = 25_000;

const reply = (text: string) => NextResponse.json({ text });

async function fromGoogleChat(req: NextRequest): Promise<boolean> {
  // The URL entered as the Chat app's "HTTP endpoint URL", with the console's
  // authentication audience set to that URL. Unset = refuse every event.
  const audience = process.env.GOOGLE_CHAT_AUDIENCE?.trim();
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!audience || !token) return false;
  try {
    const { payload } = await jwtVerify(token, GOOGLE_CERTS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
    });
    return payload.email === CHAT_ISSUER && payload.email_verified === true;
  } catch {
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

async function askClaude(question: string, name: string): Promise<string> {
  let text = "";
  const answer = runChat({
    messages: [{ role: "user", content: name ? `${name} asks: ${question}` : question }],
    model: process.env.GOOGLE_CHAT_MODEL?.trim() || "claude-haiku-5-5",
    feature: "google-chat",
    extraSystem: CHAT_SYSTEM,
    onEvent: (e) => {
      if (e.type === "text") text += e.text;
      if (e.type === "error") text += `\n${e.error}`;
    },
  }).then(() => text.trim() || "I couldn't find an answer to that.");
  const late = new Promise<string>((done) =>
    setTimeout(
      () => done("That took too long to look up. Try a narrower question, or the Assistant page in the app."),
      DEADLINE_MS,
    ),
  );
  return Promise.race([answer, late]);
}

export async function POST(req: NextRequest) {
  if (!(await fromGoogleChat(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ask = parseEvent(await req.json().catch(() => null));
  if (ask.kind === "ignore") return NextResponse.json({});
  if (ask.kind === "added") return reply(helpText());

  if (!canAsk(ask.email)) {
    return reply("Sorry, I only answer the pilot group for now. Ask the office to add you.");
  }
  if (!hasGrant()) return reply("I can't reach JobTread right now (JT_GRANT_KEY is not set).");

  try {
    if (ask.kind === "command") return reply(await runCommand(getPaveConfig(), ask.commandId, ask.arg));

    if (/^(help|\?)$/i.test(ask.text)) return reply(helpText());
    if (!process.env.ANTHROPIC_API_KEY) return reply("AI answers are off. The / commands still work.");
    if (await overMonthlyCap()) {
      return reply("This month's AI budget for chat is used up. The / commands still work (free).");
    }
    return reply(await askClaude(ask.text, ask.name));
  } catch (e) {
    console.error(`[google-chat] ${e instanceof Error ? e.message : e}`);
    return reply("Something went wrong looking that up. Try again, or use the Assistant page in the app.");
  }
}
