import { HelpBrowser } from "./HelpBrowser";

/**
 * /help — the app's instructions, one answer per question.
 *
 * Server component → client browser, the same shape as every other page here.
 * There is nothing secret to pass down: the topics ship in the bundle
 * (src/lib/help.ts) and the reader's own view set decides which ones show.
 *
 * Gated by the "help" view, which every role holds (see FIELD_VIEWS in
 * src/lib/views.ts). A view rather than an ungated route because the launcher
 * and the header's search both filter their rows by a view id.
 */
export const metadata = { title: "Help" };

export default function HelpPage() {
  return <HelpBrowser />;
}
