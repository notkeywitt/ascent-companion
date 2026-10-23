import { Onboarding } from "./Onboarding";

/**
 * New Hire Paperwork — a new hire's own profile and forms. The office side is
 * /onboarding/office. Reached from the invite link the office sends, and from
 * Today, which sends a field login with open paperwork here instead of Time.
 */
export default function OnboardingPage() {
  return <Onboarding />;
}
