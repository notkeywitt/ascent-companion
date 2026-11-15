import { redirect } from "next/navigation";

/** Notices moved onto the Office dashboard (2026-11-14). Stored links land there. */
export default function NoticesPage() {
  redirect("/office");
}
