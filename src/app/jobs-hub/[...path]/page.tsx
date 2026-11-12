import { JobsHub } from "../JobsHub";

/** Direct links, /jobs-hub/<job>/<Month>/<billId>: JobsHub reads the path itself (src/lib/hubUrl.ts). */
export default function JobsHubLinkPage() {
  return <JobsHub />;
}
