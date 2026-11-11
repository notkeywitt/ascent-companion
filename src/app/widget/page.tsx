import { WidgetView } from "./WidgetView";

export const metadata = { title: "Ascent Widget" };

/**
 * The desktop widget's page (owner, 2026-11-11). The Mac panel app in
 * `desktop-widget/` loads this one URL and nothing else.
 *
 * It is Today, cut down to what the office glances at: the billing month, the
 * queue counts, the job board and the Office job's to-dos. Each piece is the
 * Home component itself, so each self-gates on its own view exactly as it does
 * on Home. The route is ungated for the same reason Home is.
 */
export default function WidgetPage() {
  return <WidgetView />;
}
