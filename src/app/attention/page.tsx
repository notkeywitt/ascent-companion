import { redirect } from "next/navigation";

/** Needs attention moved onto the Office dashboard (2026-11-14). Stored links land there. */
export default function AttentionPage() {
  redirect("/office");
}
