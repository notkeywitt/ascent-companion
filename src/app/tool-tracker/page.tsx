import { redirect } from "next/navigation";

// The Tool Tracker (scan → relocate) flow was merged into the single Tools page.
// Keep this route alive so any old bookmark / muscle-memory link lands on it.
export default function ToolTrackerRedirect() {
  redirect("/tools");
}
