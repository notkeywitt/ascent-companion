/**
 * How each kind of LopezRocks page is drawn — one component per shape that
 * `src/lib/lopezrocksParse.ts` reads. Server components, all of them: the page
 * is read on the server and arrives as plain HTML, so it costs a phone no
 * JavaScript beyond the app's own.
 *
 * Every link goes through `LrAnchor`. A section, a post or the front page opens
 * inside the app; anything else — signing in, posting, messaging, another
 * website — opens in a new tab, on the site that owns it.
 */
import { Fragment } from "react";
import Link from "next/link";

import { Card, Chip, ChipScroller, ListCard, ListRow, MetaLine, SectionHeading, btn } from "@/components/ui";
import {
  isReaderLink,
  readerHref,
  type LrAction,
  type LrBlock,
  type LrDay,
  type LrGroup,
  type LrItem,
  type LrLink,
  type LrRow,
  type LrRun,
  type LrSection,
  type LrSponsor,
} from "@/lib/lopezrocksParse";

/* ---------------------------------------------------------------- links */

export function LrAnchor({
  link,
  className,
  children,
}: {
  link: LrLink;
  className?: string;
  children: React.ReactNode;
}) {
  // prefetch off: a list of 30 posts must not become 30 requests to the site.
  if (isReaderLink(link)) {
    return (
      <Link href={readerHref(link)} prefetch={false} className={className}>
        {children}
      </Link>
    );
  }
  const web = /^https?:/i.test(link.href);
  return (
    <a
      href={link.href}
      className={className}
      {...(web ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** A row for any LopezRocks link: inside the app, or out to another site. */
function LinkRow({ label, link, desc }: { label: string; link: LrLink; desc?: string }) {
  return isReaderLink(link) ? (
    <ListRow href={readerHref(link)} label={label} desc={desc} wrap />
  ) : (
    <ListRow href={link.href} label={label} desc={desc} wrap external />
  );
}

/** Text with its links. Line breaks are "\n", drawn by `whitespace-pre-line`. */
function Runs({ runs }: { runs: LrRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.link ? (
          <LrAnchor key={i} link={r.link} className="font-medium text-accent underline underline-offset-2">
            {r.text}
          </LrAnchor>
        ) : (
          <Fragment key={i}>{r.text}</Fragment>
        ),
      )}
    </>
  );
}

function Paragraph({ runs, className = "" }: { runs: LrRun[]; className?: string }) {
  return (
    <p className={`whitespace-pre-line break-words text-[15px] leading-relaxed ${className}`}>
      <Runs runs={runs} />
    </p>
  );
}

/** A button for a LopezRocks action. One that leaves the app says so with ↗. */
function ActionButton({ action, variant = "secondary" }: { action: LrAction; variant?: "primary" | "secondary" }) {
  return (
    <LrAnchor link={action.link} className={btn(variant, "md")}>
      {action.label}
      {!isReaderLink(action.link) && <span aria-hidden>↗</span>}
    </LrAnchor>
  );
}

/* --------------------------------------------------------------- chrome */

/** The site's own section menu, as a row you swipe sideways. */
export function SectionChips({ sections, current }: { sections: LrSection[]; current?: string }) {
  if (!sections.length) return null;
  const chip = (on: boolean) => btn(on ? "primary" : "secondary", "sm", "min-h-11 shrink-0");
  return (
    <nav aria-label="LopezRocks sections" className="mb-4">
      <ChipScroller>
        <Link href="/lopezrocks" prefetch={false} className={chip(false)}>
          Home
        </Link>
        {sections.map((s) => (
          <Link
            key={s.handle}
            href={readerHref({ kind: "section", handle: s.handle })}
            prefetch={false}
            aria-current={s.handle === current ? "page" : undefined}
            className={chip(s.handle === current)}
          >
            {s.title}
          </Link>
        ))}
      </ChipScroller>
    </nav>
  );
}

export function HeadActions({ actions }: { actions: LrAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {actions.map((a, i) => (
        <ActionButton key={i} action={a} />
      ))}
    </div>
  );
}

function Pager({ items }: { items: LrAction[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-6 flex gap-2">
      {items.map((a, i) => (
        <LrAnchor key={i} link={a.link} className={btn(i === items.length - 1 ? "primary" : "secondary", "lg", "flex-1")}>
          {a.label}
        </LrAnchor>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- shapes */

function rowDesc(r: LrRow): string | undefined {
  return [r.sub, ...r.meta].filter(Boolean).join(" · ") || undefined;
}

/** Offered, Wanted, Organizations, Let's Talk… — posts grouped by keyword. */
export function ListView({ groups, pager }: { groups: LrGroup[]; pager: LrAction[] }) {
  return (
    <div className="space-y-5">
      {groups.map((g, i) => (
        <section key={i}>
          {g.title && <SectionHeading className="mb-2">{g.title}</SectionHeading>}
          <ListCard>
            {g.rows.map((r, j) => (
              <LinkRow key={j} label={r.title} link={r.link} desc={rowDesc(r)} />
            ))}
          </ListCard>
        </section>
      ))}
      <Pager items={pager} />
    </div>
  );
}

/** "Sep 27", in the office's own time zone — the server renders in UTC. */
function monthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

export function CalendarView({ days, pager }: { days: LrDay[]; pager: LrAction[] }) {
  const now = new Date();
  const today = monthDay(now);
  const tomorrow = monthDay(new Date(now.getTime() + 864e5));
  return (
    <div className="space-y-5">
      {days.map((d, i) => (
        <section key={i}>
          <SectionHeading
            className="mb-2"
            trailing={
              d.monthDay === today ? (
                <Chip tone="accent">Today</Chip>
              ) : d.monthDay === tomorrow ? (
                <Chip>Tomorrow</Chip>
              ) : null
            }
          >
            {d.label}
          </SectionHeading>
          {d.events.length ? (
            <ListCard>
              {d.events.map((e, j) => (
                <ListRow
                  key={j}
                  href={readerHref(e.link)}
                  label={e.title}
                  wrap
                  trailing={
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-500 dark:text-neutral-400">
                      {e.time}
                    </span>
                  }
                />
              ))}
            </ListCard>
          ) : (
            <p className="px-1 text-sm text-neutral-500">Nothing listed.</p>
          )}
        </section>
      ))}
      <Pager items={pager} />
    </div>
  );
}

// The News column lists every story back to 2020 — over a thousand. The page
// shows the newest few and folds the next batch; the rest stay on the site.
const NEWS_SHOWN = 15;
const NEWS_FOLDED = 85;

/** One post, event, business, story or discussion. */
export function ItemView({ item, siteUrl }: { item: LrItem; siteUrl: string }) {
  const p = item.person;
  const phoneHref = p?.phone ? `tel:${p.phone.replace(/[^\d+]/g, "")}` : "";
  const hasContact = !!p || item.actions.length > 0;
  return (
    <article>
      {item.lead && <p className="mb-3 text-base font-semibold leading-snug">{item.lead}</p>}
      <div className="space-y-3">
        {item.body.map((runs, i) => (
          <Paragraph key={i} runs={runs} />
        ))}
      </div>

      {item.images.length > 0 && (
        <div className="mt-5 space-y-3">
          {item.images.map((img, i) => (
            <figure key={i}>
              <img
                src={img.src}
                alt={img.caption ?? ""}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full rounded-xl border border-line bg-white dark:bg-ink-raised"
              />
              {img.caption && (
                <figcaption className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{img.caption}</figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {item.links.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {item.links.map((a, i) => (
            <ActionButton key={i} action={a} />
          ))}
        </div>
      )}

      {hasContact && (
        <Card className="mt-6">
          {p?.lines[0] && <p className="text-sm font-semibold">{p.lines[0]}</p>}
          {p && <MetaLine items={[...p.lines.slice(1), p.agree && `${p.agree} agree`]} className="mt-0.5" />}
          {p?.extras.map((runs, i) => <Paragraph key={i} runs={runs} className="mt-1 text-sm" />)}
          <div className={`flex flex-wrap gap-2 ${p ? "mt-3" : ""}`}>
            {p?.phone && (
              <a href={phoneHref} className={btn("primary", "md")}>
                Call {p.phone}
              </a>
            )}
            {p?.email && (
              <a href={`mailto:${p.email}`} className={btn("secondary", "md")}>
                Email
              </a>
            )}
            {item.actions.map((a, i) => (
              <ActionButton key={i} action={a} />
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-500 dark:text-neutral-400">
            Messages, comments and Agree need a LopezRocks sign-in, so they open on the site.
          </p>
        </Card>
      )}

      {item.comments.length > 0 && (
        <section className="mt-7">
          <SectionHeading className="mb-2">
            {item.comments.length === 1 ? "1 comment" : `${item.comments.length} comments`}
          </SectionHeading>
          <Card pad={false} className="divide-y divide-line-soft">
            {item.comments.map((c, i) => (
              <div key={i} className="px-3 py-3">
                <MetaLine
                  items={[
                    c.by.lines[0] && (
                      <span className="font-semibold text-neutral-700 dark:text-neutral-200">{c.by.lines[0]}</span>
                    ),
                    ...c.by.lines.slice(1),
                    c.by.agree && `${c.by.agree} agree`,
                  ]}
                />
                <div className="mt-1.5 space-y-2">
                  {c.body.map((runs, j) => (
                    <Paragraph key={j} runs={runs} className="text-sm" />
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      {item.extra.length > 0 && (
        <div className="mt-6">
          <BlocksView blocks={item.extra} />
        </div>
      )}

      {item.back && (
        <LrAnchor link={item.back.link} className={btn("secondary", "lg", "mt-7 w-full")}>
          {item.back.label}
        </LrAnchor>
      )}

      {item.otherNews.length > 0 && (
        <section className="mt-8">
          <SectionHeading className="mb-2">Other News</SectionHeading>
          <ListCard>
            {item.otherNews.slice(0, NEWS_SHOWN).map((r, i) => (
              <LinkRow key={i} label={r.title} link={r.link} desc={rowDesc(r)} />
            ))}
          </ListCard>
          {item.otherNews.length > NEWS_SHOWN && (
            <details className="group mt-2">
              <summary
                className={btn("secondary", "md", "w-full cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden")}
              >
                <span className="group-open:hidden">
                  Show {Math.min(NEWS_FOLDED, item.otherNews.length - NEWS_SHOWN)} older stories
                </span>
                <span className="hidden group-open:inline">Hide older stories</span>
              </summary>
              <ListCard className="mt-2">
                {item.otherNews.slice(NEWS_SHOWN, NEWS_SHOWN + NEWS_FOLDED).map((r, i) => (
                  <LinkRow key={i} label={r.title} link={r.link} desc={rowDesc(r)} />
                ))}
              </ListCard>
              {item.otherNews.length > NEWS_SHOWN + NEWS_FOLDED && (
                <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={btn("ghost", "md", "mt-2 w-full")}>
                  Every older story is on LopezRocks <span aria-hidden>↗</span>
                </a>
              )}
            </details>
          )}
        </section>
      )}
    </article>
  );
}

/** Any page not drawn above — Ferries, About, Help: its headings, text, links and tables. */
export function BlocksView({ blocks }: { blocks: LrBlock[] }) {
  return (
    <div>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <SectionHeading key={i} className="mb-2 mt-6 first:mt-0">
                {b.text}
              </SectionHeading>
            );
          case "subheading":
            return (
              <h3 key={i} className="mb-1.5 mt-4 text-sm font-semibold">
                {b.text}
              </h3>
            );
          case "text":
            return <Paragraph key={i} runs={b.runs} className="mt-2" />;
          case "links":
            return (
              <ListCard key={i} className="mt-2">
                {b.items.map((a, j) => (
                  <LinkRow key={j} label={a.label} link={a.link} />
                ))}
              </ListCard>
            );
          case "table":
            return (
              <div key={i} className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j} className="border-b border-line-soft last:border-b-0">
                        {row.map((cell, k) => (
                          <td
                            key={k}
                            className={`px-2 py-2 align-top ${b.head && j === 0 ? "text-[11px] font-semibold uppercase tracking-wide text-neutral-500" : "tabular-nums"}`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "image":
            return (
              <img
                key={i}
                src={b.src}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="mt-3 w-full rounded-xl border border-line"
              />
            );
        }
      })}
    </div>
  );
}

/** The front page: every section, then the sponsors who pay for the site. */
export function HomeView({
  sections,
  supporters,
  sponsors,
}: {
  sections: LrSection[];
  supporters: LrRun[];
  sponsors: LrSponsor[];
}) {
  return (
    <div>
      <ListCard>
        {sections.map((s) => (
          <ListRow key={s.handle} href={readerHref({ kind: "section", handle: s.handle })} label={s.title} />
        ))}
      </ListCard>

      {(sponsors.length > 0 || supporters.length > 0) && (
        <section className="mt-8">
          <SectionHeading className="mb-2">Supported by</SectionHeading>
          {supporters.length > 0 && (
            <Paragraph runs={supporters} className="mb-3 text-sm text-neutral-500 dark:text-neutral-400" />
          )}
          <div className="grid grid-cols-3 gap-3 pad:grid-cols-5">
            {sponsors.map((s, i) => {
              const tile = (
                <>
                  {s.logo ? (
                    <img
                      src={s.logo}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="aspect-square w-full rounded-lg border border-line bg-white object-contain p-1.5"
                    />
                  ) : null}
                  <span className="mt-1 block text-center text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">
                    {s.name}
                  </span>
                </>
              );
              return s.link ? (
                <LrAnchor key={i} link={s.link} className="block">
                  {tile}
                </LrAnchor>
              ) : (
                <div key={i}>{tile}</div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
