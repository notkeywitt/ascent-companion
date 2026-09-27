import type { Metadata } from "next";
import Link from "next/link";

import { Banner, EmptyState, PageHeader, btn } from "@/components/ui";
import { getLopezRocksPage, type LopezRocksResult } from "@/lib/lopezrocks";
import { linkFromQuery, readerHref, siteHref, type LrLink } from "@/lib/lopezrocksParse";

import { BlocksView, CalendarView, HeadActions, HomeView, ItemView, ListView, SectionChips } from "./LopezRocksViews";

/**
 * LopezRocks — Lopez Island's community board (lopezrocks.org), drawn for a
 * phone. On the site itself every font is a share of the screen width, so a
 * phone shows it about four pixels tall.
 *
 * READ-ONLY, BY DESIGN. The server reads the page LopezRocks would have shown
 * (src/lib/lopezrocks.ts), and this draws it with the app's own components.
 * Posting, replying, messaging and signing in all need a LopezRocks account,
 * so every one of those buttons opens the site itself in a new tab — the app
 * never sees a LopezRocks password.
 *
 * The address carries the page: /lopezrocks?s=21 is a section, ?i=… one post.
 * `linkFromQuery` checks every value, so the address bar can only ever reach a
 * LopezRocks page, never make the server fetch anything else.
 *
 * Every role holds this view (FIELD_VIEWS in lib/views); the link to it is at
 * the bottom of the home page.
 */
export const metadata: Metadata = { title: "LopezRocks" };

// Each request reads its own address; nothing here is built at deploy time.
export const dynamic = "force-dynamic";

const WHY_NOT: Record<Exclude<LopezRocksResult, { ok: true }>["reason"], string> = {
  blocked: "Its firewall turns the app away now and then. Try again in a moment.",
  timeout: "It took too long to answer. Try again in a moment.",
  error: "Something went wrong reading the page. Try again, or open it on the site.",
};

/** Which section chip to light up: the section itself, or the one a post belongs to. */
function currentSection(link: LrLink): string | undefined {
  if (link.kind === "section") return link.handle;
  if (link.kind === "item") return link.menuHandle ?? (link.ret && /^\d+$/.test(link.ret) ? link.ret : undefined);
  return undefined;
}

/** The way out to the site, and whose content this is. At the foot of every page. */
function Credit({ site }: { site: string }) {
  return (
    <div className="mt-10 border-t border-line pt-4">
      <a href={site} target="_blank" rel="noopener noreferrer" className={btn("secondary", "md", "w-full")}>
        Open this page on LopezRocks <span aria-hidden>↗</span>
      </a>
      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        From{" "}
        <a href="https://lopezrocks.org" target="_blank" rel="noopener noreferrer" className="underline">
          lopezrocks.org
        </a>
        , the island&rsquo;s community board, run by SalishRocks Web Design. The app reads each page at most every 15
        minutes. Posting, replies, messages and sign-in open on LopezRocks itself.
      </p>
    </div>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const link = linkFromQuery(await searchParams);
  const res = await getLopezRocksPage(link);
  const site = siteHref(link);

  if (!res.ok) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-10 pt-5">
        <PageHeader title="LopezRocks" description="Lopez Island's community board." />
        <Banner tone="warning">
          <p className="font-semibold">LopezRocks did not answer the app this time.</p>
          <p className="mt-1">{WHY_NOT[res.reason]}</p>
          {/* A plain link, not <Link>: a full reload is the honest retry. The
              way to the site itself is the button at the foot of the page. */}
          <a href={readerHref(link)} className={btn("primary", "sm", "mt-3")}>
            Try again
          </a>
        </Banner>
        <Credit site={site} />
      </main>
    );
  }

  const { sections, page } = res.data;
  const current = currentSection(link);

  let title = res.data.title || "LopezRocks";
  let description = "";
  let body: React.ReactNode = null;
  switch (page.kind) {
    case "home":
      title = "LopezRocks";
      description = page.tagline || "A Community Website by Lopez Island";
      body = <HomeView sections={sections} supporters={page.supporters} sponsors={page.sponsors} />;
      break;
    case "list":
      title = page.head.title || title;
      description = page.head.desc;
      body = (
        <>
          <HeadActions actions={page.head.actions} />
          <ListView groups={page.groups} pager={page.pager} />
        </>
      );
      break;
    case "calendar":
      title = page.head.title || title;
      description = page.head.desc;
      body = (
        <>
          <HeadActions actions={page.head.actions} />
          <CalendarView days={page.days} pager={page.pager} />
        </>
      );
      break;
    case "item":
      title = page.item.title;
      description = page.item.details.join(" · ");
      body = <ItemView item={page.item} siteUrl={site} />;
      break;
    case "generic":
      title = page.head.title || title;
      description = page.head.desc;
      body = (
        <>
          <HeadActions actions={page.head.actions} />
          {page.blocks.length ? (
            <BlocksView blocks={page.blocks} />
          ) : (
            <EmptyState>This page has nothing to read here. Open it on LopezRocks.</EmptyState>
          )}
        </>
      );
      break;
    case "missing":
      title = "LopezRocks";
      body = (
        <EmptyState>
          LopezRocks has no page at this address.{" "}
          <Link href="/lopezrocks" prefetch={false} className="font-semibold text-accent underline">
            All sections
          </Link>
        </EmptyState>
      );
      break;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-5">
      {page.kind !== "home" && <SectionChips sections={sections} current={current} />}
      <PageHeader title={title} description={description || undefined} />
      {body}
      <Credit site={site} />
    </main>
  );
}
