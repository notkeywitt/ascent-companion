import { PageHeader } from "@/components/ui";

import { AscentBotAccess } from "./AscentBotAccess";
import { SignalChats } from "./SignalChats";

/**
 * AscentBot — who may ask the Google Chat bot, and what each person's answers
 * may draw on. Roles are named sets of areas (financials, staff records, the
 * office mailbox); every person on the list gets job knowledge. Below that,
 * the Signal chats the office Mac mini reports, each assigned to a job, the
 * office or nothing (src/lib/signalChats.ts).
 *
 * Gated by the `ascentbot` view (admin only by default). The panels talk only
 * to /api/ascentbot and /api/ascentbot/signal. The rules live in
 * src/lib/botAccess.ts.
 */
export default function AscentBotPage() {
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader
        title="AscentBot"
        description="Who may ask AscentBot in Google Chat, and what their answers may draw on."
      />
      <div className="space-y-8">
        <AscentBotAccess />
        <SignalChats />
      </div>
    </main>
  );
}
