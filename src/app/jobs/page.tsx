import { getPaveConfig } from "@/lib/config";
import { JobsBrowser } from "./JobsBrowser";

/**
 * Jobs list + budget — the first view built on the generic /api/pave gateway.
 * Server component only supplies the (non-secret) org id; all data is read
 * client-side through the gateway, so this page needs no bespoke API route.
 * Gated by the "jobs" view in src/lib/views.ts (office + admin).
 */
export default function JobsPage() {
  const { orgId } = getPaveConfig();
  return <JobsBrowser orgId={orgId} />;
}
