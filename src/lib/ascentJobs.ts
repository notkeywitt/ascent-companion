/** Ascent's own jobs (Ascent Office, Ascent Shop, …) sit below client jobs in every job list. */
export const isAscentJob = (...names: (string | undefined | null)[]) =>
  /\bascent\b/i.test(names.filter(Boolean).join(" "));
