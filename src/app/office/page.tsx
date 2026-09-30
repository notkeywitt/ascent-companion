import { Suspense } from "react";
import Link from "next/link";

import {
  Banner,
  EmptyState,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
} from "@/components/ui";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { monthLabel } from "@/lib/billingMonths";
import { currentBillingPeriod } from "@/lib/billingMonth";
import { money } from "@/lib/invoiceReview/types";
import {
  OFFICE_JOB_ID,
  getJobBillsForMonth,
  getJobFiles,
  resolveShopJobId,
  type JobFile,
  type MonthBill,
} from "@/lib/jobtread";
import { jtJobUrl } from "@/lib/jtLinks";
import { orgDay } from "@/lib/orgTime";
import { shortDay } from "@/lib/timeEntryDates";
import { OfficeImages } from "./OfficeImages";
import { OfficeTodos } from "./OfficeTodos";
import { readOfficeTodos } from "./readOfficeTodos";

/**
 * The Office dashboard — the "Office" overhead job in JobTread (job 007), read
 * live: its open to-dos, the billing month's bills on Office and Shop, its Files
 * tab as a folder browser. The other office pages are in the header menu.
 *
 * Server component. The open folder is the `?folder=` param, so moving through
 * folders is plain navigation. Each JobTread read streams in its own <Suspense>.
 * The to-dos are editable (OfficeTodos.tsx → /api/office/todos); the files are read-only.
 * Gated by the "office" view in src/lib/views.ts (office + admin).
 */

/**
 * Files attached to a bill or other document, with no folder of their own, sit
 * here. Without it ~80 bill scans bury the handful of real office folders.
 */
const DOCS_FOLDER = "Documents";

export default async function OfficePage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const folder = ((await searchParams).folder ?? "").trim().replace(/^\/+|\/+$/g, "");
  const jobUrl = jtJobUrl(OFFICE_JOB_ID);
  // The billing month set on Home (or the automatic 10th cutoff) — the same
  // month every bill filed today lands in.
  const { billingYear, billingMonthNum } = await currentBillingPeriod();
  const ym = `${billingYear}-${String(billingMonthNum).padStart(2, "0")}`;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Office Dashboard"
        description="The Office job's to-dos and files."
      />

      {!hasGrant() ? (
        <Banner tone="error">JT_GRANT_KEY is not set. Add it to .env.local and restart.</Banner>
      ) : (
        <>
          <section className="mb-6">
            <SectionHeading trailing={<JtLink href={`${jobUrl}/to-dos`} />}>To-dos</SectionHeading>
            <Suspense fallback={<Loading label="Loading to-dos…" />}>
              <Todos />
            </Suspense>
          </section>

          <section className="mb-6">
            <SectionHeading>{monthLabel(ym)} bills</SectionHeading>
            <Suspense fallback={<Loading label="Loading bills…" />}>
              <Bills year={billingYear} month={billingMonthNum} />
            </Suspense>
          </section>

          <section>
            <SectionHeading trailing={<JtLink href={`${jobUrl}/files`} />}>Files</SectionHeading>
            <Suspense key={folder} fallback={<Loading label="Loading files…" />}>
              <Files folder={folder} />
            </Suspense>
          </section>
        </>
      )}
    </main>
  );
}

function JtLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-semibold text-accent dark:text-accent-soft"
    >
      JobTread ↗
    </a>
  );
}

async function Todos() {
  try {
    return <OfficeTodos todos={await readOfficeTodos()} />;
  } catch (e) {
    return (
      <Banner tone="error">{e instanceof Error ? e.message : "Could not read to-dos."}</Banner>
    );
  }
}

/** The month's bills on the two overhead jobs, each with its total. Drafts included. */
async function Bills({ year, month }: { year: number; month: number }) {
  const cfg = getPaveConfig();
  let jobs: { name: string; bills: MonthBill[] }[];
  try {
    const shopJobId = await resolveShopJobId(cfg);
    const [office, shop] = await Promise.all([
      getJobBillsForMonth(cfg, OFFICE_JOB_ID, year, month, true, true),
      getJobBillsForMonth(cfg, shopJobId, year, month, true, true),
    ]);
    jobs = [
      { name: "Ascent Office", bills: office },
      { name: "Ascent Shop", bills: shop },
    ];
  } catch (e) {
    return <Banner tone="error">{e instanceof Error ? e.message : "Could not read bills."}</Banner>;
  }

  return (
    <div className="space-y-4">
      {jobs.map((j) => (
        <div key={j.name}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1 text-sm font-semibold">
            <span>{j.name}</span>
            <span className="tabular-nums">
              {money(j.bills.reduce((sum, b) => sum + b.cost, 0))}
            </span>
          </div>
          {j.bills.length === 0 ? (
            <p className="px-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">
              No bills this month.
            </p>
          ) : (
            <ListCard>
              {j.bills.map((b) => (
                <ListRow
                  key={b.id}
                  href={`/bill/${encodeURIComponent(b.id)}`}
                  label={b.vendor || b.label}
                  desc={<MetaLine items={[b.externalId && `#${b.externalId}`, b.status]} />}
                  trailing={
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {money(b.cost)}
                    </span>
                  }
                />
              ))}
            </ListCard>
          )}
        </div>
      ))}
    </div>
  );
}

/** Where a file shows in the browser: its own folder, else Documents for a bill scan, else the top. */
function pathOf(f: JobFile): string {
  return (f.folder ?? "").replace(/^\/+|\/+$/g, "") || (f.document ? DOCS_FOLDER : "");
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const folderHref = (path: string) =>
  path ? `/office?folder=${encodeURIComponent(path)}` : "/office";

async function Files({ folder }: { folder: string }) {
  let all: JobFile[];
  try {
    all = await getJobFiles(getPaveConfig(), OFFICE_JOB_ID);
  } catch (e) {
    return <Banner tone="error">{e instanceof Error ? e.message : "Could not read files."}</Banner>;
  }

  // The folders one level below the open one, with how many files each holds.
  const prefix = folder ? `${folder}/` : "";
  const subfolders = new Map<string, number>();
  const here: JobFile[] = [];
  for (const f of all) {
    const p = pathOf(f);
    if (p === folder) here.push(f);
    else if (p.startsWith(prefix)) {
      const name = p.slice(prefix.length).split("/")[0];
      subfolders.set(name, (subfolders.get(name) ?? 0) + 1);
    }
  }
  const crumbs = folder ? folder.split("/") : [];
  // Images show in the app as a thumbnail grid; everything else links out.
  const images = here.filter((f) => f.type.startsWith("image/"));
  const others = here.filter((f) => !f.type.startsWith("image/"));

  return (
    <>
      {folder && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm">
          <Link href={folderHref("")} className="font-semibold text-accent dark:text-accent-soft">
            Files
          </Link>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span aria-hidden className="text-neutral-400">
                /
              </span>
              {i === crumbs.length - 1 ? (
                <span className="font-semibold">{c}</span>
              ) : (
                <Link
                  href={folderHref(crumbs.slice(0, i + 1).join("/"))}
                  className="font-semibold text-accent dark:text-accent-soft"
                >
                  {c}
                </Link>
              )}
            </span>
          ))}
        </nav>
      )}

      {subfolders.size === 0 && here.length === 0 ? (
        <EmptyState>{folder ? "This folder is empty." : "No files on the Office job."}</EmptyState>
      ) : (
        <div className="space-y-3">
          {(subfolders.size > 0 || others.length > 0) && (
            <ListCard>
              {[...subfolders]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, n]) => (
                  <ListRow
                    key={`d:${name}`}
                    href={folderHref(prefix + name)}
                    label={name}
                    desc={`Folder · ${n} file${n === 1 ? "" : "s"}`}
                  />
                ))}
              {others.map((f) => (
                <ListRow
                  key={f.id}
                  href={f.url ?? undefined}
                  external
                  wrap
                  label={f.name}
                  desc={<MetaLine items={[shortDay(orgDay(f.createdAt)), sizeLabel(f.size)]} />}
                />
              ))}
            </ListCard>
          )}
          {images.length > 0 && <OfficeImages files={images} />}
        </div>
      )}
    </>
  );
}
