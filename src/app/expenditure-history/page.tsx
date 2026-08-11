import ExpenditureBrowser from "./ExpenditureBrowser";

/**
 * Expenditure History — the archive of every invoice in the Expenditure sheet,
 * including the years that predate JobTread.
 *
 * Read-only, and deliberately NOT sourced from JobTread: this is the sheet's own
 * record, which is the only place the pre-migration bills exist. See
 * ExpenditureBrowser.tsx for the shape and ascent-appscript/ExpenditureHistory.js
 * for where the data comes from.
 */
export const metadata = { title: "Expenditure History" };

export default function ExpenditureHistoryPage() {
  return <ExpenditureBrowser />;
}
