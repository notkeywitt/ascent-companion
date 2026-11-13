/**
 * Does this person still owe new-hire paperwork? SERVER ONLY.
 *
 * The same test the Home page used to run in the browser through
 * /api/onboarding/me: an intake the office has not received yet, with the
 * profile or a form still open. Any failure reads as "no paperwork".
 */
import { getIntake, listForms, listSubmissions } from "@/lib/onboarding/store";

export async function onboardingOpen(email: string): Promise<boolean> {
  try {
    const intake = await getIntake(email);
    if (!intake || intake.sentAt) return false;
    if (!intake.profileAt) return true;
    const [forms, subs] = await Promise.all([listForms(true), listSubmissions(email)]);
    const done = new Set(subs.map((s) => s.formId));
    return forms.some((f) => !done.has(f.id));
  } catch {
    return false;
  }
}
