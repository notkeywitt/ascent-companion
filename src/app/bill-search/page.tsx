import { BillSearch } from "./BillSearch";

/**
 * Bill Search — one box that searches every vendor bill and line item, live
 * JobTread plus the seeded pre-JobTread history, from a local full-text index so
 * results land in well under a second.
 *
 * Server shell only: no secret context to pass (the client talks to
 * /api/bill-search, which holds the grant key server-side). Gated to the
 * `bill-search` view in lib/views.ts.
 */
export const metadata = { title: "Bill Search" };

export default function Page() {
  return <BillSearch />;
}
