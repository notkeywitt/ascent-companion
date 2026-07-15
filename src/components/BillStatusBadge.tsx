// JobTread vendor-bill lifecycle: draft -> pending ("approved for payment", Bill
// only) -> approved ("paid", both Bill and Expense — Expense skips straight from
// draft). denied only applies to bills. Labels/mapping confirmed against the
// approve flow in bill/[docId]/page.tsx.
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Approved for Payment",
  approved: "Paid",
  denied: "Denied",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  denied: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

export function billStatusLabel(status?: string): string {
  if (!status) return "Unknown";
  return STATUS_LABELS[status] ?? status;
}

export function BillStatusBadge({ status, className = "" }: { status?: string; className?: string }) {
  const style = (status && STATUS_STYLES[status]) || "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300";
  return (
    <span
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style} ${className}`}
    >
      {billStatusLabel(status)}
    </span>
  );
}
