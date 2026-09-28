import { Suspense } from "react";
import Link from "next/link";

import {
  Banner,
  Chip,
  EmptyState,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
} from "@/components/ui";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getJobFiles, getOpenToDos, type JobFile } from "@/lib/jobtread";
import { jtJobUrl, jtToDoUrl } from "@/lib/jtLinks";
import { orgDay } from "@/lib/orgTime";
import { dayLabel, shortDay } from "@/lib/timeEntryDates";
import { OfficeLinks } from "./OfficeLinks";

/**
 * The Office dashboard — the "Office" overhead job in JobTread (job 007), read
 * live: its open to-dos, its Files tab as a folder browser, and links to the
 * other office pages (the old HR menu).
 *
 * Server component. The open folder is the `?folder=` param, so moving through
 * folders is plain navigation. Each JobTread read streams in its own <Suspense>.
 * Read-only — nothing here writes to JobTread.
 * Gated by the "office" view in src/lib/views.ts (office + admin).
 */

/** The Office job. Same id as getLeaveConfig().jobId and appscript DEFAULT_JOB_ID. */
const OFFICE_JOB_ID = "22PXevQbM9FQ";

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

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader title="Office" description="The Office job's to-dos and files, and the office pages." />

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
            <SectionHeading>Office pages</SectionHeading>
            <OfficeLinks />
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
  let todos;
  try {
    todos = (await getOpenToDos(getPaveConfig())).filter((t) => t.jobId === OFFICE_JOB_ID);
  } catch (e) {
    return <Banner tone="error">{e instanceof Error ? e.message : "Could not read to-dos."}</Banner>;
  }
  if (todos.length === 0) return <EmptyState>No open to-dos on the Office job.</EmptyState>;

  const today = orgDay(new Date().toISOString());
  const rows = todos
    .map((t) => ({ ...t, due: t.endDate || t.startDate || "" }))
    // Overdue and soonest first, undated last.
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.name.localeCompare(b.name));

  return (
    <ListCard>
      {rows.map((t) => (
        <ListRow
          key={t.id}
          href={jtToDoUrl(t.id)}
          external
          wrap
          label={t.name}
          desc={
            <MetaLine
              items={[t.due && `Due ${dayLabel(t.due)}`, t.assignees.join(", ") || "Unassigned"]}
            />
          }
          badge={t.due && t.due < today ? <Chip tone="danger">Overdue</Chip> : undefined}
        />
      ))}
    </ListCard>
  );
}

/** Where a file shows in the browser: its own folder, else Documents for a bill scan, else the top. */
function pathOf(f: JobFile): string {
  return (f.folder ?? "").replace(/^\/+|\/+$/g, "") || (f.document ? DOCS_FOLDER : "");
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const folderHref = (path: string) => (path ? `/office?folder=${encodeURIComponent(path)}` : "/office");

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

  return (
    <>
      {folder && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm">
          <Link href={folderHref("")} className="font-semibold text-accent dark:text-accent-soft">
            Files
          </Link>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span aria-hidden className="text-neutral-400">/</span>
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
          {here.map((f) => (
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
    </>
  );
}
