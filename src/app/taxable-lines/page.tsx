import { TaxableLinesBrowser } from "./TaxableLinesBrowser";

export const metadata = { title: "Taxable flags" };

/**
 * The stray `isTaxable: false` worklist. Read-only: it lists and links, and a
 * person makes each change in JobTread. See src/lib/taxableLines.ts for what is
 * listed and what is deliberately left out.
 */
export default function TaxableLinesPage() {
  return <TaxableLinesBrowser />;
}
