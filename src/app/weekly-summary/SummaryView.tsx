/**
 * One weekly summary, drawn in the app's theme. The same sections the email and
 * the printable Doc carry: a labelled section, a ruled callout for the headline
 * number, tables with a header row, bullets with a bold lead. Pure server
 * component — no state, so a closed week costs no JavaScript.
 */
import { SectionHeading, tableCls } from "@/components/ui";
import { inlineParts, isAmount, isSignOff, type SummaryBlock } from "@/lib/weeklySummary";

function Inline({ s }: { s: string }) {
  return (
    <>
      {inlineParts(s).map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white dark:bg-ink-raised">
      <table className={tableCls.root}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={tableCls.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={tableCls.tr}>
              {head.map((_, c) => {
                const cell = row[c] ?? "";
                const first = c === 0;
                return (
                  <td
                    key={c}
                    className={`${isAmount(cell) ? tableCls.tdNum : tableCls.td} ${
                      first ? "whitespace-nowrap font-semibold" : ""
                    }`}
                  >
                    <Inline s={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SummaryView({ blocks }: { blocks: SummaryBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h":
            return <SectionHeading key={i} className={i === 0 ? "" : "pt-4"}>{b.s}</SectionHeading>;
          case "callout":
            return (
              <p key={i} className="border-l-[3px] border-brand bg-neutral-50 px-3 py-2 text-sm font-semibold dark:bg-neutral-800/40">
                <Inline s={b.s} />
              </p>
            );
          case "table":
            return <Table key={i} head={b.head} rows={b.rows} />;
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-snug marker:text-neutral-400">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline s={it} />
                  </li>
                ))}
              </ul>
            );
          default:
            return (
              <p
                key={i}
                className={`text-sm ${isSignOff(b.s) ? "pt-2 text-neutral-500 dark:text-neutral-400" : ""}`}
              >
                <Inline s={b.s} />
              </p>
            );
        }
      })}
    </div>
  );
}
