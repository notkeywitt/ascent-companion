import { PunchListPage } from "./PunchListPage";

/**
 * Final Inspection Punch List for every role. Same shared list as the Jobs
 * page's Punch List tab (/api/punch-list, companion DB only). Gated by the
 * "punch-list" view.
 */
export default function Page() {
  return <PunchListPage />;
}
