/**
 * Which jobs the time clock offers an employee: the open jobs they are added
 * to in JobTread, in a phase that takes time.
 *
 * "Ascent" is the phase of the company's own jobs (Office, Shop, …). The owner
 * kept it on 2026-10-17 so overhead time can still be clocked.
 */
export const TIME_CLOCK_PHASES = ["Active", "PreCon", "Ascent"] as const;

/**
 * The jobs to list. `mine` is the set of job ids the employee is added to;
 * null means their JobTread user is not known yet, so only the phase applies.
 */
export function timeClockJobs<T extends { id: string; phase?: string | null }>(
  jobs: readonly T[],
  mine: ReadonlySet<string> | null,
): T[] {
  const phases: readonly string[] = TIME_CLOCK_PHASES;
  return jobs.filter((j) => phases.includes(j.phase ?? "") && (!mine || mine.has(j.id)));
}
