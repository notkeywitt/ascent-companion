import { BillSearch } from "./BillSearch";

/**
 * Bill Search — the full-results view over the local bill/line-item index, and
 * the home of the index's own controls (build the history seed, refresh from
 * JobTread, see how fresh it is).
 *
 * The header's global search (src/components/GlobalSearch.tsx) is the everyday
 * way in and shows a shortlist; when there are more hits than fit, it links here
 * with `?q=` so the same search opens in full. That param is read server-side and
 * handed down as the initial query.
 */
export const metadata = { title: "Bill Search" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <BillSearch initialQuery={(q ?? "").trim()} />;
}
