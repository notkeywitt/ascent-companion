"use client";

import { parseReport, type Inline } from "@/lib/reportMarkdown";

/** Claude Code's monthly report, drawn from its markdown (lib/reportMarkdown.ts). */
export function ReportText({ markdown }: { markdown: string }) {
  const blocks = parseReport(markdown);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const cls = b.level === 1 ? "text-base font-semibold" : b.level === 2 ? "text-sm font-semibold" : "text-sm font-medium opacity-80";
          return (
            <p key={i} className={`${cls} pt-1`}>
              <Inlines parts={b.content} />
            </p>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inlines parts={it} />
                </li>
              ))}
            </ul>
          );
        }
        if (b.kind === "table") {
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {b.header.map((c, j) => (
                      <th key={j} className="border-b border-line-soft px-2 py-1 text-left font-medium">
                        <Inlines parts={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className="border-b border-line-soft px-2 py-1 align-top tabular-nums">
                          <Inlines parts={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={i}>
            <Inlines parts={b.content} />
          </p>
        );
      })}
    </div>
  );
}

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "bold" ? (
          <strong key={i} className="font-semibold">
            {p.text}
          </strong>
        ) : p.kind === "link" ? (
          <a
            key={i}
            href={p.href}
            className="font-medium underline underline-offset-2 hover:opacity-80"
            {...(p.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
