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

// Text below follows ASD-STE100 (Simplified Technical English) style: short
// sentences, 1 idea per sentence, active voice, simple tenses, defined terms
// used the same way every time, no idioms, no contractions. Code blocks and
// file paths are exact quotes of the real code and stay unchanged.
function Segment1() {
  return (
    <>
      <Part n={1} name="The question">
        <Quote>
          You tap an item on your phone. A number appears on the screen. Where does this number
          come from? What steps happen before the number appears?
        </Quote>
        <P>
          After this segment, you can answer these 2 questions for any screen in the app. You can
          also name the exact files that do the work.
        </P>
      </Part>

      <Part n={2} name="The idea">
        <H2>The app is a viewer. The app is not a filing cabinet.</H2>
        <P>
          Here is the most important fact about the Ascent Assistant: <strong>the app does not
          store your business data.</strong>
        </P>
        <P>
          The app has no database of bills. The app has no copy of your jobs. Look at the Unbilled
          screen. This screen can show an amount, for example $47,320, for costs not yet on a
          customer invoice. The app did not get this amount from storage. The app got this amount
          from JobTread a few seconds before. The app will get this amount from JobTread again, the
          next time a user opens the screen.
        </P>
        <P>
          This design has 2 results. Result one: the app data can never go out of date compared to
          JobTread, because the app keeps no data of its own to go out of date. Result two: the app
          is only as fast as JobTread is. This is the reason the code uses many{" "}
          <strong>caches</strong>. A cache is a temporary store. A cache holds an old answer for a
          short time, so the app does not have to ask again right away.
        </P>

        <H2>The app has 3 back ends</H2>
        <P>
          The app is a <strong>front end</strong>. A front end is a program that shows data from
          other systems to a user. The app gets data from 3 back-end systems. Almost every screen
          combines data from 1 or more of these systems.
        </P>
        <Scroller>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-neutral-100 dark:bg-ink-raised">
                <th className="p-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-500">Back end</th>
                <th className="p-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-500">What it stores</th>
                <th className="p-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-neutral-500">Which system is correct</th>
              </tr>
            </thead>
            <tbody className="align-top text-neutral-700 dark:text-neutral-300">
              <tr className="border-t border-line-soft">
                <td className="p-2.5"><strong>JobTread</strong><br />(the &ldquo;Pave&rdquo; API)</td>
                <td className="p-2.5">Jobs, budgets, cost items, vendor bills, customer invoices, payments, time entries, contacts</td>
                <td className="p-2.5">JobTread. <strong>JobTread holds the correct value for all money data.</strong></td>
              </tr>
              <tr className="border-t border-line-soft">
                <td className="p-2.5"><strong>Google Sheets and Google Drive</strong></td>
                <td className="p-2.5">The employee roster, the tool list, the mileage log, safety sign-in records, requisitions, the Expenditure archive, PDF files</td>
                <td className="p-2.5">Ascent&rsquo;s Google Workspace</td>
              </tr>
              <tr className="border-t border-line-soft">
                <td className="p-2.5"><strong>The companion database</strong></td>
                <td className="p-2.5">The data with no other home: RFIs, feature requests, the sign-in allow list, leave balances, lead follow-ups, editable page text. 18 tables in total.</td>
                <td className="p-2.5">This app</td>
              </tr>
            </tbody>
          </table>
        </Scroller>
        <P>
          A simple rule decides which system stores a fact. Learn this rule now. This rule explains
          many decisions in the code:
        </P>
        <Quote>
          <strong>
            Check JobTread first. Use Sheets only if the data was already there. Use the companion
            database only if JobTread and Sheets have no place for the data.
          </strong>
        </Quote>
        <P>
          This rule explains the design of the Time Off feature. JobTread has no object for a leave
          request. So the app stores a leave request in the companion database. But an approved
          leave request becomes hours worked on a job. JobTread does have an object for this: the{" "}
          <strong>time entry</strong>. So the app writes an approved leave request into JobTread, as
          a time entry.
        </P>

        <H2>The fourth part: the app&rsquo;s own server</H2>
        <P>
          There is a fourth part of this system. Many users do not know about this part. This part
          is the key to Segment 2 and Segment 4.
        </P>
        <P>
          Your phone does <strong>not</strong> send requests to JobTread. Your phone cannot do this
          safely. JobTread requires a <strong>grant key</strong> for every request. A grant key acts
          like a password. A grant key gives access to all the company&rsquo;s money data. A browser
          can be read by any person who holds the phone. For this reason, a grant key must never
          reach the browser.
        </P>
        <Code>{`  YOUR PHONE                 VERCEL (the app's server)          THE WORLD
  ----------                 -------------------------          ---------
  the screen      --asks-->  a server route          --asks-->   JobTread
  (a "client                 (the only place the                 Sheets/Drive
   component")                secret key is used)                the database
                  <-plain--                         <-data---
                    numbers`}</Code>
        <P>
          The left half is public. Any person who holds the phone can see this half. The right half
          is private. This half runs on Vercel&rsquo;s servers. This half holds every secret key.
          Every piece of data, for every screen, crosses this line exactly 1 time. Remember this
          diagram. Almost every design rule in this code comes from this 1 fact.
        </P>
      </Part>

      <Part n={3} name="The evidence">
        <P>
          This part follows 1 real screen through the full system. The example is the Jobs cost
          browser, at the route <IC>/jobs</IC>. A <strong>route</strong> is the address of a screen.
          This screen shows a job&rsquo;s budget against the job&rsquo;s actual cost. This screen has
          the same layout as the office Tracking Sheet.
        </P>

        <H3>Hop 1 — The page (11 lines)</H3>
        <P>
          Here is the file <IC>src/app/jobs/page.tsx</IC>. This is the entire file:
        </P>
        <Code>{`import { JobsBrowser } from "./JobsBrowser";

export default function JobsPage() {
  return <JobsBrowser />;
}`}</Code>
        <P>
          This file shows the pattern for every screen in the app. Each screen has a small file
          named <IC>page.tsx</IC>. This file runs on the <em>server</em>. This file has 1 job: to
          send control to a larger component. This larger component runs in the <em>browser</em>.
          The server part is the safe place for secret keys. The browser part shows buttons and
          receives taps. This design puts the border, between safe code and unsafe code, directly
          into the file structure.
        </P>
        <P>
          Learn this naming rule now: a folder under <IC>src/app/</IC> becomes a URL. The folder{" "}
          <IC>src/app/jobs/</IC> becomes the URL <IC>/jobs</IC>. The folder{" "}
          <IC>src/app/time-off/</IC> becomes the URL <IC>/time-off</IC>. The folder{" "}
          <IC>src/app/bill/[docId]/</IC> becomes a URL such as <IC>/bill/22ABC123</IC>. The square
          brackets mean: put any value here. This is the full routing rule. The app has 39 folders
          of this kind. The app has 39 screens. This course page is proof of the rule: this page
          lives at <IC>src/app/course/</IC>.
        </P>

        <H3>Hop 2 — The browser asks the app&rsquo;s own server</H3>
        <P>
          The file <IC>src/app/jobs/JobsBrowser.tsx</IC> starts with these words: <IC>&quot;use
          client&quot;</IC>. These 2 words mark a border. Every file that starts with these words
          runs <strong>on the phone</strong>. A file with these words must never contain a secret
          key.
        </P>
        <P>When the screen loads, this file sends a request:</P>
        <Code>{`fetch("/api/jobs/browser")`}</Code>
        <P>
          Read this request with care. This request asks for <IC>/api/jobs/browser</IC>. This is{" "}
          <strong>a route on the Ascent Assistant server</strong>, not a route on JobTread. The
          phone does not know that JobTread exists. The phone sends a request to its own app. The
          app sends an answer back to the phone.
        </P>
        <P>
          Later, when a user picks 1 job, the same file sends a second request:
        </P>
        <Code>{`fetch(\`/api/jobs/cost-detail?jobId=\${encodeURIComponent(id)}\`)`}</Code>
        <P>
          This is the same pattern. The phone sends a request to the app&rsquo;s own server. This
          request also carries the job&rsquo;s ID.
        </P>

        <H3>Hop 3 — The server route (the side with the secret key)</H3>
        <P>
          Here is the file <IC>src/app/api/jobs/browser/route.ts</IC>. This file has 41 lines. Read
          the full file for more detail. Here is the main part of the file:
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
        <P>Here is an explanation, in plain words, for each line:</P>
        <UL>
          <li>
            <IC>getPaveConfig()</IC> reads the server&rsquo;s environment variables. These
            variables hold the JobTread grant key and the organization ID. A comment in this file
            states a rule: never import this function into a client component. A client component
            runs on the phone.
          </li>
          <li>
            <IC>getJobs(cfg, true)</IC> and <IC>getJobPhaseMap(cfg)</IC> each send 1 request to
            JobTread. The code sends both requests at the same time. The instruction{" "}
            <IC>Promise.all</IC> does this: it starts both requests together, then waits for both
            answers.
          </li>
          <li>
            <IC>jobs.map(...)</IC> joins the 2 answers into 1 result. This step adds each
            job&rsquo;s Phase value onto the matching job record.
          </li>
          <li>
            <IC>revalidate: 300</IC> sets a cache time of 300 seconds. This means: store this
            answer for 300 seconds, which is 5 minutes. During these 300 seconds, give this stored
            answer to any user who opens the Jobs screen. Do not ask JobTread again during this
            time.
          </li>
        </UL>
        <P>
          A comment in this file explains the reason for this design. This comment gives a clear
          view into the design choices in this code:
        </P>
        <Quote>
          &ldquo;Doing the join here instead of in the browser is the load-time fix: the client used
          to page <IC>organization.jobs</IC> (up to 10 gateway round trips) and then page the Status
          custom field (up to 20 more) on every single page load. Now it is one fetch.&rdquo;
        </Quote>
        <P>
          In plain words: the old code asked <IC>organization.jobs</IC> from the browser, in up to
          10 separate requests. The old code then asked for the Status custom field, in up to 20
          more requests. The new code asks 1 time only. A change of this kind is not visible on the
          screen. But this kind of change makes a large difference in practice, for example on a
          job site with a weak phone signal.
        </P>

        <H3>Hop 4 — The request to JobTread</H3>
        <P>
          The function <IC>getJobs</IC> is in the file <IC>src/lib/jobtread.ts:1911</IC>. This
          function has a <em>second</em> cache. This cache lives in the app&rsquo;s own memory. This
          cache also stores an answer for 5 minutes. Almost every office screen reads the job list.
          For this reason, the app stores this answer in 2 separate caches.
        </P>
        <P>
          The real work happens in <IC>_getJobsUncached</IC>. Here, for the first time, is what a
          request to JobTread looks like:
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
          JobTread reads a special data language, named <strong>Pave</strong>. A message in this
          language is named a <strong>query</strong>. You do not need to write a query yet. You can
          read a query now, because the words in this language are plain:
        </P>
        <Quote>
          &ldquo;Get the organization with this ID. From this organization, get the list of jobs.
          For each job, give the <strong>ID</strong>, the <strong>name</strong>, the{" "}
          <strong>number</strong>, and the <strong>closedOn</strong> date. For each job, also get
          the <strong>location</strong>. From the location, give the account name and the formatted
          address.&rdquo;
        </Quote>
        <P>
          An empty pair of braces, <IC>{"{}"}</IC>, has 1 meaning: give this value only, with no
          data nested inside it. The symbol <IC>$</IC> has 1 meaning: here are the arguments for
          this part of the query. This is almost the whole grammar of the Pave language. Segment 3
          explains this language in full.
        </P>
        <P>
          JobTread sends back a maximum of <strong>100 records in 1 answer</strong>. JobTread also
          sends a <IC>nextPage</IC> token. A token of this kind works like a bookmark. The code
          sends this token back in the next query. The code repeats this action until JobTread
          sends no more tokens.
        </P>

        <H3>Hop 5 — The actual network call</H3>
        <P>
          The function <IC>pave()</IC>, in <IC>src/lib/jobtread.ts</IC>, is the only function in
          the whole code that sends data to the address <IC>https://api.jobtread.com/pave</IC>.
          Here is the first line of this function:
        </P>
        <Code>{`const body = JSON.stringify({
  query: { $: { grantKey: cfg.grantKey }, ...query },
});`}</Code>
        <P>
          <strong>This line adds the grant key to the query.</strong> Every other file in the app
          writes a query without the grant key. The function <IC>pave()</IC> adds the grant key at
          the last step, on the server. Then this function sends the query to JobTread. This design
          has 1 result: the code has only 1 place to check for the grant key. This design makes the
          security rule easy to trust.
        </P>
        <P>
          The function <IC>pave()</IC> also controls repeat attempts. Read the comments in the file
          for the full detail. Here is the plain rule: <strong>the app repeats a failed read up to
          3 times. The app never repeats a failed write.</strong> A read does not change stored
          data. A write does change stored data, for example a request to create a bill. If a write
          times out, and the app repeats the write, the result can be 2 bills instead of 1.
        </P>

        <H2>The full trip, in 1 view</H2>
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
          This trip uses <strong>6 files</strong>. This trip uses <strong>2 caches</strong>. The
          grant key appears in <strong>1 place</strong> only. Every screen in the app follows a
          similar trip.
        </P>
        <Callout label="One fact that is not part of this trip">
          <P>
            Notice what did not happen. The phone did not send a grant key. The phone did not know
            the JobTread address. Even a broken copy of the app on the phone could not send a query
            to JobTread. Segment 4 explains how the app protects this rule.
          </P>
        </Callout>
      </Part>

      <Part n={4} name="Check yourself">
        <Lead>Try each question before you read the answer.</Lead>
        <QA q="1. A coworker says this: “The app’s copy of the job list is old. Please re-import the list.” What is wrong with this request?">
          <P>
            <strong>The app has no copy of the job list to re-import.</strong> The app holds no job
            list of its own. The list can look old for 1 of 2 reasons. Reason one: a cache holds an
            old answer, for up to 5 minutes. Reason two: JobTread itself has old data. The correct
            fix is to wait, or to clear the cache. The correct fix is never to &ldquo;re-import&rdquo;
            data.
          </P>
        </QA>
        <QA q="2. You open the Jobs screen. You open the Jobs screen again, 90 seconds later. How many times did the app ask JobTread for the job list? Why?">
          <P>
            <strong>1 time.</strong> Two caches store the answer: the route cache, for 300 seconds,
            and the in-memory cache, for 5 minutes. At 90 seconds, both caches still hold the
            answer. JobTread is not asked again. For this same reason, a new job in JobTread can
            take a few minutes to appear in the app. This is a known, accepted result of the
            design.
          </P>
        </QA>
        <QA q="3. Look at these 3 files: jobs/page.tsx, jobs/JobsBrowser.tsx, and api/jobs/browser/route.ts. Which file can safely hold the JobTread grant key?">
          <P>
            Only <IC>api/jobs/browser/route.ts</IC> can safely hold the grant key. This file does
            hold the grant key, through the function <IC>getPaveConfig()</IC>. The file{" "}
            <IC>JobsBrowser.tsx</IC> has the mark <IC>&quot;use client&quot;</IC>. This file runs on
            the phone. A grant key in this file would become visible to the phone. The file{" "}
            <IC>page.tsx</IC> runs on the server. But, by design rule, this file never holds a grant
            key. This file has 1 job: to send control to another component. The app keeps all
            grant-key use inside the folder <IC>src/app/api/</IC>. This rule makes the security
            design easy to check.
          </P>
        </QA>
        <QA q="4. What URL comes from the file src/app/time-off/page.tsx?">
          <P>
            <strong>
              <IC>/time-off</IC>
            </strong>
            . The folder path under <IC>src/app/</IC> becomes the URL.
          </P>
        </QA>
        <QA q="5. Why does the app repeat a failed read to JobTread, but never repeat a failed write?">
          <P>
            A read does not change stored data. If a read fails, the read changed nothing. A repeat
            of the read is safe. A write does change stored data, for example a new bill. If a
            write times out, the app cannot know the true result. The write can have reached
            JobTread before the connection failed. A repeat of the write can create a second bill,
            a second line, or a second payment.
          </P>
        </QA>
        <QA q="6. An RFI stays in the companion database. An approved PTO day goes into JobTread. Explain the reason for each choice.">
          <P>
            <strong>RFI:</strong> JobTread has no object for an RFI. The Sheets system also has no
            place for an RFI. For this reason, the companion database is the only correct home for
            RFI data.
          </P>
          <P>
            <strong>PTO:</strong> JobTread has no object for a PTO request, and no object for a PTO
            approval step. For this reason, the companion database stores the request and the
            approval step. But an approved PTO day becomes hours worked on a job. JobTread does have
            an object for this: the time entry. For this reason, the app writes the approved PTO day
            into JobTread, as a time entry. All other labor-cost data already lives in this same
            place.
          </P>
        </QA>
      </Part>

      <Part n={5} name="What this unlocks">
        <P>After this segment, you can do these 4 things:</P>
        <UL>
          <li>
            <strong>Find the code for any screen, from its URL alone.</strong> The URL{" "}
            <IC>/unbilled</IC> points to the folder <IC>src/app/unbilled/</IC>. This 1 skill makes
            the other 11 segments easier to follow.
          </li>
          <li>
            <strong>Trace a slow request in the correct order.</strong> A person may say: &ldquo;The
            page is slow.&rdquo; You now know 5 places to check: the phone&rsquo;s request, the
            route, the cache, the JobTread query, and JobTread itself.
          </li>
          <li>
            <strong>Ask for a change in exact, useful terms.</strong> Good example: &ldquo;Add the
            job&rsquo;s Phase to the Jobs browser.&rdquo; You know that the app already reads this
            value, in the file <IC>src/app/api/jobs/browser/route.ts</IC>.
          </li>
          <li>
            <strong>Find a dangerous proposal.</strong> Some proposals are always wrong. A proposal
            is wrong if it lets the browser send a query to JobTread directly. A proposal is wrong
            if it stores a grant key where a phone can read it. You do not need more information to
            reject a proposal of this kind.
          </li>
        </UL>
        <Callout label="Next up">
          <H3>Segment 2 — Sign-In and Roles</H3>
          <P>
            This segment explains how the app decides who can sign in. This segment explains the 4
            roles. This segment explains 1 more fact: for a Field employee, the Financials screens
            are not just hidden. The server blocks these screens before the page runs.
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
