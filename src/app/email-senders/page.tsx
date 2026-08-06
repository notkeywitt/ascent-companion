import EmailSenders from "./EmailSenders";

// Server shell — all data + UI live in the client component, which talks to the
// Apps Script registry through /api/email-senders (no JobTread grant key here).
export default function EmailSendersPage() {
  return <EmailSenders />;
}
