import { PageHeader } from "@/components/ui";

/**
 * The one header the Bills dashboard's statement and import tabs share
 * (Sunset, LSWDD, Amazon): a title, a one-line description, optional actions,
 * and a summary row of figures. Page body goes in `children`.
 */
export interface SummaryItem {
  label: string;
  value: React.ReactNode;
  /** Draw the figure in the warning colour (something waits on the office). */
  warn?: boolean;
}

export function StatementShell({
  title,
  description,
  actions,
  summary,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  summary?: SummaryItem[];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <PageHeader titleSlot={<h2 className="text-lg font-semibold">{title}</h2>} description={description} actions={actions} className="!mb-3" />
      {summary && summary.length > 0 && (
        <dl className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary.map((s) => (
            <div key={s.label} className="rounded-card border border-neutral-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{s.label}</dt>
              <dd className={`text-base font-semibold tabular-nums ${s.warn ? "text-warn" : ""}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </div>
  );
}
