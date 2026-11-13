// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { type JobToDo, groupRecentToDos } from "@/lib/jobBoard";
import { cachedRef, pageAll, pageEach, pave, PAVE_PAGE_SIZE, type PaveConfig, PaveTooManyPagesError } from "./core";
// ---------------------------------------------------------------------------
// TASKS — schedule items and to-dos (Daily Digest)
// ---------------------------------------------------------------------------

export interface OpenToDo {
  id: string;
  name: string;
  description?: string;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD
  progress?: number | null; // 0..1, or null when JobTread has no value
  jobId?: string | null;
  jobName?: string | null;
  jobAddress?: string | null; // job.location.address — the "where" for a digest item
  assignees: string[]; // display names, from assignedMemberships.user.name
  /** The same people as JobTread USER ids — how "is this mine?" is decided
   *  without matching on a display name. Empty when the fallback selection ran. */
  assigneeIds: string[];
}

/**
 * Every open (not fully done) task of the given kind across the org — the
 * shared query behind `getOpenToDos` and `getScheduledTasks` below. "Open"
 * means `progress` is null or under 1 — JobTread has no separate boolean
 * completion flag on the task itself (only per-subtask `isComplete`), so
 * `progress` is the read this uses; a write against it is unconfirmed, but
 * this function never writes.
 *
 * `assignees` resolves `assignedMemberships` to each member's JobTread display
 * name (same names `getOrgUsers` returns), so a digest check can group by
 * person without a second lookup.
 *
 * TWO PHASES, for the assignees. Nesting `assignedMemberships` in the paged
 * walk returns HTTP 413 (probed live 2026-10-19, size 100). It used to, and the
 * catch below then fell back to a read with no description and no assignees —
 * so every to-do lost its details and its person, and "mine" matched nothing.
 * The walk now reads the tasks bare, and `_getToDoAssignees` fetches the
 * assignees for the OPEN ones only, by id. A failed assignee read throws: a
 * list that quietly shows nobody's name is the bug this replaced.
 */
export async function fetchTasks(cfg: PaveConfig, isToDo: boolean): Promise<OpenToDo[]> {
  const q = (nodes: Record<string, unknown>, args: Record<string, unknown>) => ({
    organization: {
      $: { id: cfg.orgId },
      id: {},
      tasks: {
        $: { where: { and: [["isToDo", isToDo]] }, ...args },
        nextPage: {},
        nodes,
      },
    },
  });
  const rich = {
    id: {},
    name: {},
    description: {},
    startDate: {},
    endDate: {},
    progress: {},
    job: { id: {}, name: {}, location: { address: {} } },
    // No assignedMemberships here — see the 413 note above.
  };
  const min = {
    id: {},
    name: {},
    startDate: {},
    endDate: {},
    progress: {},
    job: { id: {}, name: {} },
  };

  const out: OpenToDo[] = [];
  const walkWith = (nodes: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: `organization.tasks (${isToDo ? "to-dos" : "schedule"})`,
      query: (args) => q(nodes, args),
      pick: (r) => r?.organization?.tasks,
    });
  // An unconfirmed field name won't break the digest. Too much data is not a
  // field-name problem, so that is not retried.
  const nodes = await walkWith(rich).catch((e) => {
    if (e instanceof PaveTooManyPagesError) throw e;
    return walkWith(min);
  });
  const open = nodes.filter((n) => {
    const progress = typeof n.progress === "number" ? n.progress : null;
    return progress === null || progress < 1; // else done
  });
  const people = await _getToDoAssignees(
    cfg,
    open.map((n) => n.id),
  );
  {
    for (const n of open) {
      const progress = typeof n.progress === "number" ? n.progress : null;
      const { names: assignees, ids: assigneeIds } = people.get(n.id) ?? { names: [], ids: [] };
      out.push({
        id: n.id,
        name: n.name || "(untitled)",
        description: n.description || undefined,
        startDate: n.startDate ?? null,
        endDate: n.endDate ?? null,
        progress,
        jobId: n.job?.id ?? null,
        jobName: n.job?.name ?? null,
        jobAddress: n.job?.location?.address ?? null,
        assignees,
        assigneeIds,
      });
    }
  }
  return out;
}

/**
 * A JobTread member, found by the email address they sign in with.
 *
 * WHO AM I, IN JOBTREAD — the reliable answer. The Employee roster link
 * (src/lib/jtUserLink.ts) answers the same question through the Google Sheet,
 * but it is only right when an admin has linked that person, and an unlinked
 * account silently becomes "nobody" — which is how the To Dos card first
 * shipped showing unassigned work instead of the reader's own. A JobTread
 * membership already carries the person's email, so matching on it needs no
 * roster row and no display-name guess.
 *
 * Case- and whitespace-insensitive: JobTread stores whatever case the invite
 * used ("Rachelzable@gmail.com").
 *
 * Cached 30 minutes, next to `getOrgUsers` — a membership's email changes when
 * somebody is re-invited, which is not a per-request concern.
 */
export interface MemberRef {
  userId: string;
  membershipId: string;
  name: string;
  email: string;
}

export function getMembersByEmail(cfg: PaveConfig): Promise<Map<string, MemberRef>> {
  return cachedRef(`membersByEmail:${cfg.orgId}`, 30 * 60_000, () =>
    _getMembersByEmailUncached(cfg),
  );
}
export async function _getMembersByEmailUncached(cfg: PaveConfig): Promise<Map<string, MemberRef>> {
  const out = new Map<string, MemberRef>();
  await pageEach<any>(
    cfg,
    {
      label: "organization.memberships (by email)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          memberships: {
            $: args,
            nextPage: {},
            nodes: { id: {}, user: { id: {}, name: {}, emailAddress: {} } },
          },
        },
      }),
      pick: (r) => r?.organization?.memberships,
    },
    (rows) => {
      for (const n of rows) {
        const email = String(n?.user?.emailAddress ?? "")
          .trim()
          .toLowerCase();
        if (!email || !n?.user?.id) continue;
        // First membership wins: one address can hold both an internal seat and
        // a customer-contact seat, and the internal one is created first.
        if (!out.has(email)) {
          out.set(email, {
            userId: n.user.id,
            membershipId: n.id ?? "",
            name: n.user.name ?? "",
            email,
          });
        }
      }
    },
  );
  return out;
}

/** The JobTread member who signs in with `email`, or null. */
export async function findMemberByEmail(cfg: PaveConfig, email: string): Promise<MemberRef | null> {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return null;
  return (await getMembersByEmail(cfg)).get(key) ?? null;
}

/** Every open to-do across the org, for the Daily Digest — the `isToDo=true` half. */
export async function getOpenToDos(cfg: PaveConfig): Promise<OpenToDo[]> {
  return fetchTasks(cfg, true);
}

/**
 * The same open to-dos, kept 60 s — for the read-only lists (the Jobs page's My
 * to-dos). /api/todos keeps the live read: its card must show the to-do you
 * just added.
 */
export function getOpenToDosCached(cfg: PaveConfig): Promise<OpenToDo[]> {
  return cachedRef(`opentodos:${cfg.orgId}`, 60_000, () => getOpenToDos(cfg));
}

/**
 * Each job's newest OPEN to-dos, at most `perJob` per job — the Jobs page
 * cards. "Open" is the digest's rule: progress null or under 1.
 *
 * ONE org-wide walk, newest first, filtered in the query. The org held 248
 * to-dos and 33 open ones on a job (2026-10-03), so one page covers it; a
 * per-job read would cost a request per card. Cached 60 s — a to-do is a
 * quick human edit, and the page should show it on the next load or two.
 *
 * TWO PHASES, for the assignee names. Nesting `assignedMemberships` in the
 * walk returns HTTP 413, even with an inner `size: 5`: JobTread sizes the
 * request by the page sizes asked for, not by the data (probed live
 * 2026-10-03 — outer size 40 passes, 50 fails, on a one-id filter). So the
 * walk reads the to-dos bare, and a second read fetches assignees for only
 * the to-dos that made a card, by id, 25 at a time. If that second read
 * fails, the cards still show their to-dos, without names.
 */
export function getRecentJobToDos(cfg: PaveConfig, perJob = 3): Promise<Record<string, JobToDo[]>> {
  return cachedRef(`jobtodos:${cfg.orgId}:${perJob}`, 60_000, async () => {
    const nodes = await pageAll<any>(cfg, {
      label: "organization.tasks (open job to-dos)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          tasks: {
            $: {
              where: {
                and: [
                  ["isToDo", true],
                  { "!=": [{ field: ["job", "id"] }, { value: null }] },
                  {
                    or: [
                      { "=": [{ field: "progress" }, { value: null }] },
                      { "<": [{ field: "progress" }, { value: 1 }] },
                    ],
                  },
                ],
              },
              sortBy: [{ field: "createdAt", order: "desc" }],
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              createdAt: {},
              endDate: {},
              job: { id: {} }, // no assignedMemberships here — see the 413 note above
            },
          },
        },
      }),
      pick: (r) => r?.organization?.tasks,
    });
    const byJob = groupRecentToDos(
      nodes
        .filter((n) => n?.job?.id)
        .map((n) => ({
          jobId: n.job.id as string,
          id: n.id,
          name: n.name || "(untitled)",
          createdAt: n.createdAt ?? "",
          due: n.endDate ?? null,
          assignees: [],
        })),
      perJob,
    );
    const shown = Object.values(byJob).flat();
    const people = await _getToDoAssignees(
      cfg,
      shown.map((t) => t.id),
    ).catch((e) => {
      console.warn("getRecentJobToDos: assignee read failed —", e);
      return new Map<string, ToDoAssignees>();
    });
    for (const t of shown) t.assignees = people.get(t.id)?.names ?? [];
    return byJob;
  });
}

/** Page size for the assignee read — under the 413 limit (40 passed, 50 failed). */
export const TODO_ASSIGNEE_CHUNK = 25;

/** How many assignee chunks are in flight at once — the schedule holds ~470 open tasks. */
export const TODO_ASSIGNEE_PARALLEL = 5;

/** One task's assignees: display names, and the same people as JobTread USER ids. */
export interface ToDoAssignees {
  names: string[];
  ids: string[];
}

/** task id → its assignees, for a known list of task ids (to-dos or schedule items). */
export async function _getToDoAssignees(cfg: PaveConfig, ids: string[]): Promise<Map<string, ToDoAssignees>> {
  const out = new Map<string, ToDoAssignees>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += TODO_ASSIGNEE_CHUNK) {
    chunks.push(ids.slice(i, i + TODO_ASSIGNEE_CHUNK));
  }
  // Each chunk is ONE page: the filter names at most `size` ids, so there is
  // never a second page to walk.
  const read = (chunk: string[]) =>
    pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        id: {},
        tasks: {
          $: {
            size: TODO_ASSIGNEE_CHUNK,
            where: { in: [{ field: "id" }, chunk.map((value) => ({ value }))] },
          },
          nodes: { id: {}, assignedMemberships: { nodes: { user: { id: {}, name: {} } } } },
        },
      },
    });
  const results: any[] = [];
  for (let i = 0; i < chunks.length; i += TODO_ASSIGNEE_PARALLEL) {
    results.push(...(await Promise.all(chunks.slice(i, i + TODO_ASSIGNEE_PARALLEL).map(read))));
  }
  for (const r of results) {
    for (const n of (r?.organization?.tasks?.nodes ?? []) as any[]) {
      if (!n?.id) continue;
      const members = (n.assignedMemberships?.nodes ?? []) as any[];
      out.set(n.id, {
        names: members
          .map((m) => m?.user?.name)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
        ids: members
          .map((m) => m?.user?.id)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      });
    }
  }
  return out;
}

/**
 * Every open SCHEDULE item across the org, for the Daily Digest — the
 * `isToDo=false` half of the same `task` object `getOpenToDos` reads. This is
 * job-level dated work (a site visit, an inspection, an install date), not a
 * personal calendar event — that's the Google Calendar side, read separately
 * by the Apps Script `digestCalendar` action / `calendarEventsCheck`.
 */
export async function getScheduledTasks(cfg: PaveConfig): Promise<OpenToDo[]> {
  return fetchTasks(cfg, false);
}

/** One item on a job's schedule or to-do list, for AscentBot. */
export interface JobScheduleItem {
  id: string;
  name: string;
  /** The phase (parent group row) it sits under, e.g. "Rough-In". */
  phase: string;
  description: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  progress: number | null; // 0..1
  isToDo: boolean;
  assignees: string[];
}

/**
 * Every schedule item and to-do on one job, by start date — what AscentBot reads
 * for "when is the plumber scheduled?". Group rows (phases) are dropped; each
 * item carries its phase name instead. Done items are kept: "when did framing
 * finish?" is a fair question too.
 *
 * Assignees come in a second read by id (`_getToDoAssignees`): nesting
 * `assignedMemberships` in the paged walk returns HTTP 413 (probed live
 * 2026-10-28 on an 85-task job, size 100). Fields confirmed by introspection
 * and a live read the same day.
 */
export async function getJobSchedule(cfg: PaveConfig, jobId: string): Promise<JobScheduleItem[]> {
  const nodes = await pageAll<any>(cfg, {
    label: "job.tasks (schedule)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        tasks: {
          $: { ...args },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            isToDo: {},
            isGroup: {},
            startDate: {},
            endDate: {},
            progress: {},
            parentTask: { name: {} },
          },
        },
      },
    }),
    pick: (r) => r?.job?.tasks,
  });
  const items = nodes.filter((n) => !n?.isGroup);
  const people = await _getToDoAssignees(
    cfg,
    items.map((n) => n.id),
  );
  return items
    .map((n) => ({
      id: String(n.id),
      name: String(n.name ?? "") || "(untitled)",
      phase: String(n.parentTask?.name ?? ""),
      description: String(n.description ?? ""),
      startDate: n.startDate ?? null,
      endDate: n.endDate ?? null,
      progress: typeof n.progress === "number" ? n.progress : null,
      isToDo: Boolean(n.isToDo),
      assignees: people.get(n.id)?.names ?? [],
    }))
    .sort((a, b) => (a.startDate ?? a.endDate ?? "9999").localeCompare(b.startDate ?? b.endDate ?? "9999"));
}

/** One daily log or comment on a job, for AscentBot. */
export interface JobNote {
  kind: "dailyLog" | "comment";
  /** YYYY-MM-DD for a daily log; the full timestamp for a comment. */
  date: string;
  author: string;
  /** A comment's subject line; "" for a daily log. */
  subject: string;
  text: string;
  /** What a comment is attached to: job, task, document, file, dailyLog… */
  on: string;
}

/**
 * A job's daily logs and comments, newest first — where a decision written
 * down in JobTread lives. Fields confirmed by introspection and a live read
 * 2026-10-28.
 */
export async function getJobNotes(cfg: PaveConfig, jobId: string): Promise<JobNote[]> {
  const [logs, comments] = await Promise.all([
    pageAll<any>(cfg, {
      label: "job.dailyLogs",
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          dailyLogs: { $: { ...args }, nextPage: {}, nodes: { id: {}, date: {}, notes: {}, user: { name: {} } } },
        },
      }),
      pick: (r) => r?.job?.dailyLogs,
    }),
    pageAll<any>(cfg, {
      label: "job.comments",
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          comments: {
            $: { ...args },
            nextPage: {},
            nodes: { id: {}, createdAt: {}, name: {}, message: {}, targetType: {}, createdByUser: { name: {} } },
          },
        },
      }),
      pick: (r) => r?.job?.comments,
    }),
  ]);
  const notes: JobNote[] = [
    ...logs.map((n) => ({
      kind: "dailyLog" as const,
      date: String(n.date ?? ""),
      author: String(n.user?.name ?? ""),
      subject: "",
      text: String(n.notes ?? ""),
      on: "job",
    })),
    ...comments.map((n) => ({
      kind: "comment" as const,
      date: String(n.createdAt ?? ""),
      author: String(n.createdByUser?.name ?? ""),
      subject: String(n.name ?? ""),
      text: String(n.message ?? ""),
      on: String(n.targetType ?? ""),
    })),
  ];
  return notes.filter((n) => n.text.trim() || n.subject.trim()).sort((a, b) => b.date.localeCompare(a.date));
}

/** One line of a vendor bill, as AscentBot reads it: what was bought, never what it cost. */
export interface BoughtLine {
  name: string;
  description: string;
  costCode: string;
  vendor: string;
  billNumber: string;
  /** YYYY-MM-DD */
  issueDate: string;
  status: string;
}

/** Pages read by `getBoughtLines`. A word as broad as a vendor's name can match thousands of lines. */
export const BILL_LINE_PAGES = 3;

/**
 * The lines of a job's vendor bills that mention ANY of `words` in the line's
 * name or description, its cost code's number or name, or the vendor's name.
 * Newest bill first. Voided (`denied`) bills are left out. The match runs in
 * Pave (`like` is case-insensitive), so a busy job returns only what matched;
 * the read stops after BILL_LINE_PAGES pages and says so in `more`.
 * Read-only. Fields confirmed by introspection and a live read 2026-10-28.
 */
export async function getBoughtLines(
  cfg: PaveConfig,
  jobId: string,
  words: string[],
): Promise<{ lines: BoughtLine[]; more: boolean }> {
  const like = (path: string[], w: string) => [path, "like", `%${w.replace(/[%_]/g, "")}%`];
  const match = words
    .filter((w) => w.replace(/[%_]/g, ""))
    .flatMap((w) => [
      like(["name"], w),
      like(["description"], w),
      like(["costCode", "name"], w),
      like(["costCode", "number"], w),
      like(["document", "account", "name"], w),
    ]);
  const where = {
    and: [
      [["document", "type"], "vendorBill"],
      [["document", "status"], "!=", "denied"],
      ...(match.length ? [{ or: match }] : []),
    ],
  };
  const rows = await pageAll<any>(cfg, {
    label: "job.costItems (bill lines)",
    stopAfterPages: BILL_LINE_PAGES,
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: { ...args, where, sortBy: [{ field: ["document", "issueDate"], order: "desc" }] },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            costCode: { number: {}, name: {} },
            document: { number: {}, status: {}, issueDate: {}, account: { name: {} } },
          },
        },
      },
    }),
    pick: (r) => r?.job?.costItems,
  });
  const lines = rows.map((r) => {
    const name = String(r.name ?? "");
    const code = String(r.costCode?.number ?? "");
    const desc = String(r.description ?? "");
    return {
      name,
      // Bill imports often copy the name or the cost code into the description; that says nothing new.
      description: desc === name || (code && desc.startsWith(code)) ? "" : desc,
      costCode: [code, r.costCode?.name].filter(Boolean).join(" "),
      vendor: String(r.document?.account?.name ?? ""),
      billNumber: String(r.document?.number ?? ""),
      issueDate: String(r.document?.issueDate ?? "").slice(0, 10),
      status: String(r.document?.status ?? ""),
    };
  });
  return { lines, more: rows.length >= BILL_LINE_PAGES * PAVE_PAGE_SIZE };
}

/** One line of a client document (proposal, selection, change order), as AscentBot reads it. No prices. */
export interface ScopeLine {
  document: string;
  documentNumber: string;
  status: string;
  /** YYYY-MM-DD */
  issueDate: string;
  name: string;
  description: string;
  costCode: string;
  /** The line's group, e.g. "Selections", and the group's own note (often the decision and who made it). */
  group: string;
  groupNote: string;
  /** On a selection: true for the option chosen, false for one passed over. */
  isSelected: boolean | null;
}

/** Pages read by `getJobScopeLines`. A proposal runs to tens of lines, not thousands. */
export const SCOPE_PAGES = 3;

/**
 * The lines of a job's client documents — the type JobTread calls
 * `customerOrder`: proposals, selections, change orders — that mention ANY of
 * `words` in the line's name or description, its group's name or note, its
 * cost code, or the document's name. Newest document first. Denied documents
 * are left out; pending ones come back with their status. `isSelected` says
 * which option of a selection was chosen. Never a price. Read-only. Fields
 * confirmed live 2026-10-29.
 */
export async function getJobScopeLines(
  cfg: PaveConfig,
  jobId: string,
  words: string[],
): Promise<{ lines: ScopeLine[]; more: boolean }> {
  const like = (path: string[], w: string) => [path, "like", `%${w}%`];
  const match = words
    .map((w) => w.replace(/[%_]/g, ""))
    .filter(Boolean)
    .flatMap((w) => [
      like(["name"], w),
      like(["description"], w),
      like(["costGroup", "name"], w),
      like(["costGroup", "description"], w),
      like(["costCode", "name"], w),
      like(["document", "name"], w),
    ]);
  const where = {
    and: [
      [["document", "type"], "customerOrder"],
      [["document", "status"], "!=", "denied"],
      ...(match.length ? [{ or: match }] : []),
    ],
  };
  const rows = await pageAll<any>(cfg, {
    label: "job.costItems (client documents)",
    stopAfterPages: SCOPE_PAGES,
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: { ...args, where, sortBy: [{ field: ["document", "issueDate"], order: "desc" }] },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            isSelected: {},
            costCode: { number: {}, name: {} },
            costGroup: { name: {}, description: {} },
            document: { name: {}, number: {}, status: {}, issueDate: {} },
          },
        },
      },
    }),
    pick: (r) => r?.job?.costItems,
  });
  const lines = rows.map((r) => ({
    document: String(r.document?.name ?? ""),
    documentNumber: String(r.document?.number ?? ""),
    status: String(r.document?.status ?? ""),
    issueDate: String(r.document?.issueDate ?? "").slice(0, 10),
    name: String(r.name ?? ""),
    description: String(r.description ?? ""),
    costCode: [r.costCode?.number, r.costCode?.name].filter(Boolean).join(" "),
    group: String(r.costGroup?.name ?? ""),
    groupNote: String(r.costGroup?.description ?? ""),
    isSelected: typeof r.isSelected === "boolean" ? r.isSelected : null,
  }));
  return { lines, more: rows.length >= SCOPE_PAGES * PAVE_PAGE_SIZE };
}

/** One to-do to create in JobTread — the input to `createToDo` below. */
export interface NewToDo {
  /** What to do. Required; JobTread collapses runs of whitespace. */
  name: string;
  /** Longer note. JobTread caps this at 4096 characters. */
  description?: string;
  /** Org-local "YYYY-MM-DD". Written to `endDate`, which is what a to-do shows
   *  as its due date and what `dueDateOf` (digest/checks/jobtreadTodos.ts) reads. */
  dueDate?: string;
  /** The job this to-do is about. Omitted → the to-do is filed on the ORG. */
  jobId?: string;
  /** Who it is for — MEMBERSHIP ids (`UserRef.membershipId`), not user ids. Max 20. */
  membershipIds?: string[];
  /** Whether JobTread notifies the assignees. Defaults to true, same as Pave. */
  notify?: boolean;
}

/**
 * Create a JobTread TO-DO (`task` with `isToDo: true`) — the write behind the
 * To Dos card's create form on the home page.
 *
 * TARGET, not parent: a to-do is filed against a record, and the pair
 * (`targetType`, `targetId`) is how. `job` + the job's id puts it on that job's
 * to-do list, which is where a to-do about work belongs; with no job it goes on
 * the ORGANIZATION, JobTread's company-wide list. `account` (a customer) is the
 * third target Pave accepts and there is no `document` one — a to-do cannot be
 * attached to a bill or an invoice.
 *
 * ASSIGNMENT IS BY MEMBERSHIP. `assignedMembershipIds` takes membership ids, so
 * a caller holding a JobTread USER id has to map it first (`UserRef.membershipId`
 * from `getOrgUsers`). Passing a user id here silently assigns nobody.
 *
 * Callers gate behind `writesEnabled()`. Input shape confirmed by introspecting
 * `root.createTask.$` 2026-09-08; the write itself is NOT live-probed.
 */
export async function createToDo(cfg: PaveConfig, todo: NewToDo): Promise<{ id: string }> {
  const name = (todo.name ?? "").trim();
  if (!name) throw new Error("A to-do needs a name.");
  const membershipIds = (todo.membershipIds ?? []).map((s) => s.trim()).filter(Boolean);
  if (membershipIds.length > 20) {
    throw new Error(`A to-do can be assigned to at most 20 people (got ${membershipIds.length}).`);
  }
  const jobId = (todo.jobId ?? "").trim();
  const args: Record<string, unknown> = {
    name,
    isToDo: true,
    targetType: jobId ? "job" : "organization",
    targetId: jobId || cfg.orgId,
    assignedMembershipIds: membershipIds,
  };
  const description = (todo.description ?? "").trim();
  if (description) args.description = description.slice(0, 4096);
  const dueDate = (todo.dueDate ?? "").trim();
  if (dueDate) args.endDate = dueDate;
  if (todo.notify === false) args.notify = false;

  const r = await pave(cfg, {
    createTask: { $: args, createdTask: { id: {} } },
  });
  const id = r?.createTask?.createdTask?.id;
  if (!id) throw new Error("JobTread accepted the to-do but returned no id.");
  return { id: String(id) };
}

/** The "Office" overhead job (job 007) — the Office dashboard's to-dos and files. */
export const OFFICE_JOB_ID = "22PXevQbM9FQ";

/** A change to one to-do. An omitted field is left alone; `null` clears it. */
export interface ToDoPatch {
  name?: string;
  description?: string | null;
  /** Org-local "YYYY-MM-DD" → `endDate`. `null` clears both endDate and startDate,
   *  because a to-do's due date reads as endDate, else startDate. */
  dueDate?: string | null;
  /** REPLACES the whole assignee set. Membership ids, as for `createToDo`. */
  membershipIds?: string[];
  /** true → progress 1 (JobTread's done); false → progress 0 (open again). */
  done?: boolean;
}

/** Which job a to-do sits on, or null when the id is not a to-do. */
export async function getToDoJobId(cfg: PaveConfig, id: string): Promise<string | null | undefined> {
  const r = await pave(cfg, { task: { $: { id }, id: {}, isToDo: {}, job: { id: {} } } });
  if (!r?.task?.isToDo) return undefined;
  return r.task.job?.id ?? null;
}

/**
 * WRITE — edit one JobTread to-do (`updateTask`). Input shape confirmed by
 * introspecting `root.updateTask.$` 2026-09-28 (progress 0–1, endDate/description
 * nullable); the write itself is NOT live-probed. Callers gate behind
 * `writesEnabled()` and check the to-do's job first.
 */
export async function updateToDo(cfg: PaveConfig, id: string, patch: ToDoPatch): Promise<void> {
  const args: Record<string, unknown> = { id };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("A to-do needs a name.");
    args.name = name;
  }
  if (patch.description !== undefined) {
    args.description = (patch.description ?? "").trim().slice(0, 4096) || null;
  }
  if (patch.dueDate !== undefined) {
    args.endDate = patch.dueDate || null;
    if (!patch.dueDate) args.startDate = null;
  }
  if (patch.membershipIds !== undefined) {
    if (patch.membershipIds.length > 20) {
      throw new Error(`A to-do can be assigned to at most 20 people (got ${patch.membershipIds.length}).`);
    }
    args.assignedMembershipIds = patch.membershipIds;
  }
  if (patch.done !== undefined) args.progress = patch.done ? 1 : 0;
  await pave(cfg, { updateTask: { $: args } });
}

/** WRITE — delete one JobTread to-do (`deleteTask`). Same gates as `updateToDo`. */
export async function deleteToDo(cfg: PaveConfig, id: string): Promise<void> {
  await pave(cfg, { deleteTask: { $: { id } } });
}

/** One leaf schedule task, as the tool schedule reads it. */
export interface ScheduleTask {
  id: string;
  name: string;
  /** The phase (parent group row) it sits under, "" when it has none. */
  phase: string;
  /** That phase's id and JobTread sort key, for grouping and ordering like JobTread's Gantt. */
  phaseId?: string;
  phasePosition?: string;
  /** Its own JobTread sort key (fractional index) within its phase. */
  position?: string;
  taskTypeId: string | null;
  taskTypeName: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  progress: number | null; // 0..1
  jobId: string;
  jobName: string;
}

/**
 * Every open leaf schedule task, on any job, that overlaps `from`..`to`
 * (YYYY-MM-DD) — the demand side of the tool schedule (TOOL_SCHEDULE_PLAN.md).
 *
 * Leaf rows only: a group row (`isGroup`) spans its children, so counting it
 * would double the demand. Done tasks (`progress` 1) are dropped in code, as in
 * `fetchTasks`. No nested connection, so the paged walk stays under the 413
 * limit. Query shape probed live 2026-11-10: 116 tasks in the next 6 months.
 */
export function getUpcomingScheduleTasks(cfg: PaveConfig, from: string, to: string): Promise<ScheduleTask[]> {
  return cachedRef(`toolScheduleTasks:${cfg.orgId}:${from}:${to}`, 5 * 60_000, () =>
    _getUpcomingScheduleTasksUncached(cfg, from, to),
  );
}
export async function _getUpcomingScheduleTasksUncached(
  cfg: PaveConfig,
  from: string,
  to: string,
): Promise<ScheduleTask[]> {
  const rows = await pageAll<any>(cfg, {
    label: "organization.tasks (tool schedule)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        tasks: {
          $: {
            where: {
              and: [
                ["isToDo", false],
                ["isGroup", false],
                { "!=": [{ field: ["job", "id"] }, { value: null }] },
                { ">=": [{ field: ["endDate"] }, { value: from }] },
                { "<=": [{ field: ["startDate"] }, { value: to }] },
              ],
            },
            sortBy: [{ field: "startDate", order: "asc" }],
            ...args,
          },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            startDate: {},
            endDate: {},
            progress: {},
            position: {},
            taskType: { id: {}, name: {} },
            parentTask: { id: {}, name: {}, position: {} },
            job: { id: {}, name: {} },
          },
        },
      },
    }),
    pick: (r) => r?.organization?.tasks,
  });
  const out: ScheduleTask[] = [];
  for (const n of rows) {
    if (!n?.startDate || !n?.endDate || !n?.job?.id) continue;
    const progress = typeof n.progress === "number" ? n.progress : null;
    if (progress !== null && progress >= 1) continue;
    out.push({
      id: n.id,
      name: n.name || "(untitled)",
      phase: n.parentTask?.name ?? "",
      phaseId: n.parentTask?.id ?? "",
      phasePosition: n.parentTask?.position ?? "",
      position: n.position ?? "",
      taskTypeId: n.taskType?.id ?? null,
      taskTypeName: n.taskType?.name ?? null,
      startDate: n.startDate,
      endDate: n.endDate,
      progress,
      jobId: n.job.id,
      jobName: n.job.name ?? "",
    });
  }
  return out;
}
