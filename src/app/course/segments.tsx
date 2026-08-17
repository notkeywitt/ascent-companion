/**
 * Segment prose for "Reading Your Own App" + the small set of presentational
 * helpers the lessons are written on. Built on the app's tokens (accent rule,
 * border-line hairlines, font-mono for code) so a lesson reads as part of the
 * app, not a bolt-on. Metadata (titles, order, ready flags) lives in
 * src/lib/course.ts; this file is only the bodies.
 *
 * The written source of record is docs/course/*.md. Keep the two in step: this
 * is the same text, marked up for the app.
 */

import type { ReactNode } from "react";
import { SectionHeading } from "@/components/ui";

/* ----------------------------------------------------------- prose helpers */

/** One of a segment's five parts: an accent rule + caption, then its content. */
function Part({ n, name, children }: { n: number; name: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-line pt-7 first:border-t-0 first:pt-0">
      <SectionHeading>
        {n} · {name}
      </SectionHeading>
      {children}
    </section>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-bold tracking-tight text-balance">{children}</h2>;
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="text-[15px] font-semibold tracking-tight">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">{children}</p>;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">{children}</p>;
}

function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="ml-4 list-disc space-y-2 text-[15px] leading-relaxed text-neutral-700 marker:text-neutral-400 dark:text-neutral-300">
      {children}
    </ul>
  );
}

function OL({ children }: { children: ReactNode }) {
  return (
    <ol className="ml-4 list-decimal space-y-2 text-[15px] leading-relaxed text-neutral-700 marker:text-neutral-400 dark:text-neutral-300">
      {children}
    </ol>
  );
}

/** Inline code. */
function IC({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-line bg-neutral-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-ink-raised">
      {children}
    </code>
  );
}

/** A code / diagram block. Pass the content as a string child. */
function Code({ children }: { children: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-neutral-100 dark:bg-ink-raised">
      <pre className="p-3 font-mono text-[12.5px] leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent pl-3 text-[15px] italic leading-relaxed text-neutral-600 dark:text-neutral-400">
      {children}
    </blockquote>
  );
}

/** An accented aside — the "next up" and "one thing that is not…" boxes. */
function Callout({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-line border-l-2 border-l-accent bg-white p-3 dark:bg-ink-raised">
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

/** A check-yourself question: tap to reveal the answer. */
function QA({ q, children }: { q: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-line bg-white px-3 py-2.5 dark:bg-ink-raised">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-accent transition group-open:rotate-45" aria-hidden>
          +
        </span>
        <span>{q}</span>
      </summary>
      <div className="mt-2.5 space-y-2 border-t border-line-soft pt-2.5 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
        {children}
      </div>
    </details>
  );
}

function Scroller({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border border-line">{children}</div>;
}

/* ------------------------------------------------------------- Segment 1 */

function Segment1() {
  return (
    <>
      <Part n={1} name="The question">
        <Quote>
          When you tap something on your phone and a number appears on the screen — what actually
          happened, and where did that number come from?
        </Quote>
        <P>
          By the end of this segment you&rsquo;ll be able to answer that for any screen in the app,
          and name the specific files involved.
        </P>
      </Part>

      <Part n={2} name="The idea">
        <H2>The app is a lens, not a filing cabinet</H2>
        <P>
          The most important thing to understand about the Ascent Assistant is what it{" "}
          <em>doesn&rsquo;t</em> do: <strong>it doesn&rsquo;t store your business data.</strong>
        </P>
        <P>
          There&rsquo;s no &ldquo;Ascent Assistant database of bills.&rdquo; There&rsquo;s no copy of
          your jobs. When the Unbilled screen shows you $47,320 of uninvoiced cost on a job, that
          number did not come out of storage. It was fetched from JobTread seconds ago, and it will
          be fetched again the next time someone opens the screen.
        </P>
        <P>
          That&rsquo;s a deliberate choice with a real consequence:{" "}
          <strong>the app can never be out of sync with JobTread</strong>, because it has nothing of
          its own to fall out of sync. It also means the app is only as fast as JobTread is — which
          is why caching shows up so much in the code.
        </P>

        <H2>The three back ends</H2>
        <P>
          &ldquo;The app&rdquo; is really a front end sitting in front of three different places
          where data lives. Almost every screen is a combination of these.
        </P>
        <Scroller>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-neutral-100 dark:bg-ink-raised">
                <th className="p-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-500">Back end</th>
                <th className="p-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-500">What lives there</th>
                <th className="p-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-500">Who owns it</th>
              </tr>
            </thead>
            <tbody className="align-top text-neutral-700 dark:text-neutral-300">
              <tr className="border-t border-line-soft">
                <td className="p-2.5"><strong>JobTread</strong><br />(the &ldquo;Pave&rdquo; API)</td>
                <td className="p-2.5">Jobs, budgets, cost items, vendor bills, customer invoices, payments, time entries, contacts</td>
                <td className="p-2.5">JobTread. <strong>Source of truth for anything financial.</strong></td>
              </tr>
              <tr className="border-t border-line-soft">
                <td className="p-2.5"><strong>Google Sheets &amp; Drive</strong></td>
                <td className="p-2.5">Employee roster, tool inventory, mileage log, safety sign-ins, requisitions, the Expenditure archive, PDFs</td>
                <td className="p-2.5">Ascent&rsquo;s Google Workspace</td>
              </tr>
              <tr className="border-t border-line-soft">
                <td className="p-2.5"><strong>The companion database</strong></td>
                <td className="p-2.5">The leftovers: RFIs, feature requests, the sign-in allowlist, leave balances, lead follow-ups, editable page text</td>
                <td className="p-2.5">This app</td>
              </tr>
            </tbody>
          </table>
        </Scroller>
        <P>
          The rule that decides which one a piece of data belongs in is simple, and it explains a{" "}
          <em>lot</em> of file placement:
        </P>
        <Quote>
          <strong>
            JobTread first. Sheets if it was already there. The companion database only if neither of
            the other two has a home for it.
          </strong>
        </Quote>
        <P>
          That&rsquo;s why leave <em>requests</em> live in the companion database — JobTread has no
          concept of a PTO request — but approved leave gets <em>posted into JobTread</em> as a time
          entry, because JobTread does have a concept of hours against a job.
        </P>

        <H2>The fourth thing: the app&rsquo;s own server</H2>
        <P>Here&rsquo;s the piece that&rsquo;s easy to miss, and it&rsquo;s the key to Segments 2 and 4.</P>
        <P>
          Your phone does <strong>not</strong> talk to JobTread. It can&rsquo;t — the JobTread key is
          a password to your entire company&rsquo;s financial data, and anything sent to a browser can
          be read by whoever holds the phone.
        </P>
        <Code>{`  YOUR PHONE                 VERCEL (the app's server)          THE WORLD
  ----------                 -------------------------          ---------
  the screen      --asks-->  a server route          --asks-->   JobTread
  (a "client                 (the only place the                 Sheets/Drive
   component")                secret key is used)                the database
                  <-plain--                         <-data---
                    numbers`}</Code>
        <P>
          The left half is public — anyone with the phone can see it. The right half is private,
          running on Vercel&rsquo;s servers with the secrets. Every piece of data on every screen
          crosses that line exactly once. Keep that diagram in your head. Nearly every architectural
          rule in this codebase is a consequence of it.
        </P>
      </Part>

      <Part n={3} name="The evidence">
        <P>
          Let&rsquo;s follow one real screen all the way through: <strong>the Jobs cost browser</strong>{" "}
          (<IC>/jobs</IC>) — the screen showing a job&rsquo;s budget vs. actual, laid out like the
          office Tracking Sheet.
        </P>

        <H3>Hop 1 — The page (11 lines)</H3>
        <P>
          <IC>src/app/jobs/page.tsx</IC>, the entire file:
        </P>
        <Code>{`import { JobsBrowser } from "./JobsBrowser";

export default function JobsPage() {
  return <JobsBrowser />;
}`}</Code>
        <P>
          That&rsquo;s it. <strong>This is the pattern for every screen in the app</strong>: a tiny{" "}
          <IC>page.tsx</IC> that runs on the <em>server</em>, whose only job is to hand off to a
          bigger component that runs in the <em>browser</em>. The server half is where secrets would
          be safe; the browser half is where buttons and taps live. Splitting them makes the boundary
          visible in the file structure itself.
        </P>
        <P>
          <strong>Naming convention worth learning now:</strong> a folder under <IC>src/app/</IC>{" "}
          <em>is</em> a URL. <IC>src/app/jobs/page.tsx</IC> &rarr; <IC>/jobs</IC>.{" "}
          <IC>src/app/time-off/page.tsx</IC> &rarr; <IC>/time-off</IC>. That&rsquo;s the whole routing
          rule — the folders under <IC>src/app/</IC> are the screens. (This very page proves it:
          it lives at <IC>src/app/course/</IC>.)
        </P>

        <H3>Hop 2 — The browser asks the app&rsquo;s own server</H3>
        <P>
          <IC>src/app/jobs/JobsBrowser.tsx</IC> starts with <IC>&quot;use client&quot;</IC>. Those two
          words are the border marker: everything in a file beginning with them runs{" "}
          <strong>on the phone</strong>. No secrets may appear here, ever. When the screen loads, it
          runs:
        </P>
        <Code>{`fetch("/api/jobs/browser")`}</Code>
        <P>
          Read that carefully — it&rsquo;s asking for <IC>/api/jobs/browser</IC>,{" "}
          <strong>a route on the Ascent Assistant itself</strong>, not on JobTread. The phone has no
          idea JobTread exists. It asks its own app a question and gets an answer.
        </P>

        <H3>Hop 3 — The server route (the secret side)</H3>
        <P>
          <IC>src/app/api/jobs/browser/route.ts</IC> is 41 lines and worth reading in full. The core:
        </P>
        <Code>{`const getCachedJobBrowserList = unstable_cache(
  async () => {
    const cfg = getPaveConfig();
    const [jobs, phases] = await Promise.all([
      getJobs(cfg, true),
      getJobPhaseMap(cfg),
    ]);
    return jobs.map((j) => ({ ...j, phase: phases[j.id] ?? null }));
  },
  ["api-jobs-browser"],
  { revalidate: 300, tags: ["jt-jobs"] },
);`}</Code>
        <P>In English, line by line:</P>
        <UL>
          <li>
            <IC>getPaveConfig()</IC> — reach into the server&rsquo;s environment variables and pull
            out the JobTread grant key and org id. Its comment says <em>&ldquo;Never import this into
            client components&rdquo;</em> — i.e. never let this run on a phone.
          </li>
          <li>
            <IC>getJobs(cfg, true)</IC> and <IC>getJobPhaseMap(cfg)</IC> — two questions to JobTread,
            asked at the same time (<IC>Promise.all</IC> = &ldquo;do both, wait for both&rdquo;).
          </li>
          <li>
            <IC>revalidate: 300</IC> — <strong>cache this answer for 300 seconds.</strong> The next
            person to open the Jobs screen inside that window gets the stored answer instantly,
            without JobTread being asked again.
          </li>
        </UL>
        <P>The file&rsquo;s own comment explains why it exists, and it&rsquo;s a good window into how this codebase thinks:</P>
        <Quote>
          &ldquo;Doing the join here instead of in the browser is the load-time fix: the client used
          to page <IC>organization.jobs</IC> (up to 10 gateway round trips) and then page the Status
          custom field (up to 20 more) on every single page load. Now it is one fetch.&rdquo;
        </Quote>
        <P>
          Thirty round trips from a phone on job-site cell service became one. That&rsquo;s the kind
          of decision that&rsquo;s invisible on screen and enormous in practice.
        </P>

        <H3>Hop 4 — Asking JobTread</H3>
        <P>
          <IC>getJobs</IC> lives in the big shared JobTread module, <IC>src/lib/jobtread.ts</IC>. It
          wraps the real work in a <em>second</em> cache — this one inside the app&rsquo;s own memory,
          also 5 minutes. Job lists are read on nearly every office screen, so they&rsquo;re worth
          remembering twice. Underneath, this is the first time you&rsquo;ll see what a question to
          JobTread actually looks like:
        </P>
        <Code>{`const r = await pave(cfg, {
  organization: {
    $: { id: cfg.orgId },
    jobs: {
      $: args,
      nextPage: {},
      nodes: {
        id: {}, name: {}, number: {}, closedOn: {},
        location: { account: { name: {} }, formattedAddress: {} },
      },
    },
  },
});`}</Code>
        <P>
          This is JobTread&rsquo;s query language (&ldquo;Pave&rdquo;). You don&rsquo;t need to write
          it yet, but you should be able to <em>read</em> it, because it&rsquo;s remarkably literal:
        </P>
        <Quote>
          &ldquo;From the <strong>organization</strong> with this id, get its <strong>jobs</strong>.
          For each one, give me the <strong>id</strong>, <strong>name</strong>,{" "}
          <strong>number</strong>, <strong>closedOn</strong> date, and from its{" "}
          <strong>location</strong>, the <strong>account&rsquo;s name</strong> and the{" "}
          <strong>formatted address</strong>.&rdquo;
        </Quote>
        <P>
          The empty braces mean &ldquo;just the value, nothing nested inside it.&rdquo; The{" "}
          <IC>$</IC> key means &ldquo;arguments.&rdquo; That&rsquo;s essentially the whole grammar,
          and Segment 3 covers it properly. JobTread hands back at most 100 records at a time plus a{" "}
          <IC>nextPage</IC> token — a bookmark — and a loop keeps asking, feeding the bookmark back,
          until JobTread stops handing them out.
        </P>

        <H3>Hop 5 — The actual network call</H3>
        <P>
          Finally, <IC>pave()</IC> in <IC>src/lib/jobtread.ts</IC> is the one function in the entire
          codebase that talks to <IC>https://api.jobtread.com/pave</IC>. Its first line:
        </P>
        <Code>{`const body = JSON.stringify({
  query: { $: { grantKey: cfg.grantKey }, ...query },
});`}</Code>
        <P>
          <strong>This is the moment the key is attached.</strong> Every other file in the app
          composes questions <em>without</em> the key; <IC>pave()</IC> stamps it on at the last
          second, on the server, and sends it. That single choke point is why the security promise is
          credible — there&rsquo;s exactly one place to check. <IC>pave()</IC> also decides retries:{" "}
          <strong>a read that fails is retried up to three times; a write is never retried</strong>,
          because re-sending &ldquo;create a bill&rdquo; after a timeout might create two.
        </P>

        <H2>The whole trip, at a glance</H2>
        <Code>{`  /jobs on your phone
    |
    +- src/app/jobs/page.tsx ............ server, 11 lines, hands off
    +- src/app/jobs/JobsBrowser.tsx ..... "use client" - runs on the phone
    |     +- fetch("/api/jobs/browser") . asks its OWN server
    |              |
    |              v         ~~~~ the security line ~~~~
    +- src/app/api/jobs/browser/route.ts  server, has the secrets, 5-min cache
    |     +- getJobs() ................. src/lib/jobtread.ts, 5-min cache
    |           +- pave() ............. attaches the key, calls JobTread
    |                 +--> api.jobtread.com/pave
    v
  numbers on the screen`}</Code>
        <P>
          <strong>Six files. Two caches. One place the key appears.</strong> Every screen in this app
          is a variation on that trip.
        </P>
        <Callout label="One thing that is not on this trip">
          <P>
            The phone never sent a JobTread key, never knew a JobTread URL, and couldn&rsquo;t have
            asked JobTread anything even if the code were tampered with. Protecting that property is
            what Segment 4 is entirely about.
          </P>
        </Callout>
      </Part>

      <Part n={4} name="Check yourself">
        <Lead>Try each one before you open the answer.</Lead>
        <QA q="1. A colleague says “the app’s copy of the job list is stale — can you re-import it?” What’s wrong with the question?">
          <P>
            <strong>There is no copy to re-import.</strong> The app holds no job list of its own. If
            the list looks stale it&rsquo;s either a cache holding an answer for up to 5 minutes, or
            JobTread itself is behind — and the fix is to wait or clear the cache, never to
            &ldquo;re-import.&rdquo;
          </P>
        </QA>
        <QA q="2. You open the Jobs screen, then open it again 90 seconds later. How many times did JobTread get asked for the job list?">
          <P>
            <strong>Once.</strong> Both caches — Next&rsquo;s route cache at 300 seconds and the
            in-memory cache at 5 minutes — still hold the answer at 90 seconds. This is also why a job
            created in JobTread can take a few minutes to appear in the app: a known, deliberate
            trade.
          </P>
        </QA>
        <QA q="3. Which of jobs/page.tsx, jobs/JobsBrowser.tsx, or api/jobs/browser/route.ts could safely contain the JobTread grant key?">
          <P>
            Only <IC>api/jobs/browser/route.ts</IC> could — and it does, via <IC>getPaveConfig()</IC>.{" "}
            <IC>JobsBrowser.tsx</IC> is marked <IC>&quot;use client&quot;</IC>, so it runs on the phone
            and the key would be exposed. <IC>page.tsx</IC> runs on the server but by convention never
            uses the key — it exists only to hand off. Keeping key use confined to{" "}
            <IC>src/app/api/**</IC> is what makes the rule auditable.
          </P>
        </QA>
        <QA q="4. What URL does the file src/app/time-off/page.tsx serve?">
          <P>
            <strong>
              <IC>/time-off</IC>
            </strong>
            . The folder path under <IC>src/app/</IC> is the URL.
          </P>
        </QA>
        <QA q="5. Why is a failed read to JobTread retried automatically, but a failed write is not?">
          <P>
            A read that never completed changed nothing — asking again is free and safe. A write that
            timed out is ambiguous: it may have landed in JobTread before the connection dropped.
            Re-sending it risks a duplicate bill, line, or payment.
          </P>
        </QA>
        <QA q="6. An RFI lives in the companion database, but an approved PTO day gets written into JobTread. Why does each live where it does?">
          <P>
            <strong>RFIs:</strong> JobTread has no RFI object at all, and RFIs aren&rsquo;t part of
            the pre-existing Sheets world, so the companion database is the only home left.
          </P>
          <P>
            <strong>PTO:</strong> the request-and-approval workflow has no JobTread equivalent, so
            that part lives in the companion database. But once approved, the result is simply{" "}
            <em>hours against a job</em> — exactly what a JobTread time entry is — so it posts there,
            where the rest of the company&rsquo;s labour cost already lives.
          </P>
        </QA>
      </Part>

      <Part n={5} name="What this unlocks">
        <P>You can now:</P>
        <UL>
          <li>
            <strong>Locate any screen&rsquo;s code from its URL.</strong> <IC>/unbilled</IC> &rarr;{" "}
            <IC>src/app/unbilled/</IC>. This alone makes the other eleven segments navigable.
          </li>
          <li>
            <strong>Read a request the right way round.</strong> When someone says &ldquo;the page is
            slow,&rdquo; you have five specific places to ask about: the phone&rsquo;s request, the
            route, the cache, the JobTread query, and JobTread itself.
          </li>
          <li>
            <strong>Ask for changes precisely.</strong> &ldquo;The Jobs browser should also show the
            job&rsquo;s Phase&rdquo; is answerable — you know it&rsquo;s already fetched, in{" "}
            <IC>src/app/api/jobs/browser/route.ts</IC>.
          </li>
          <li>
            <strong>Spot a dangerous suggestion.</strong> If any proposal involves the browser talking
            to JobTread directly, or storing a JobTread key anywhere a phone can reach, it&rsquo;s
            wrong — and you don&rsquo;t need more context to say so.
          </li>
        </UL>
        <Callout label="Next up">
          <H3>Segment 2 — The door</H3>
          <P>
            How the app decides who gets in, what the four roles mean, and why a Field employee
            doesn&rsquo;t just have the Financials screens <em>hidden</em> — they&rsquo;re locked
            before the page ever runs.
          </P>
        </Callout>
      </Part>
    </>
  );
}

/* --------------------------------------------------------------- registry */

/** Segment number → its body component. Only written segments appear here. */
export const SEGMENT_BODIES: Record<number, () => ReactNode> = {
  1: Segment1,
};

export function hasBody(n: number): boolean {
  return n in SEGMENT_BODIES;
}
