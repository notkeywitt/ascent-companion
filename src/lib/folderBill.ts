/**
 * A Drive folder of invoices, read as ONE bill.
 *
 * The office files each invoice as `<CSI> - <amount> - <what it was>.pdf`, e.g.
 * `26 20 00 - 86.16 - relay_and_flex_conduit_from_all_phase.pdf`. The name holds
 * the three facts a bill line needs, so a folder becomes one bill with one line
 * per file and no model call. Pure: the Drive listing comes in as plain names.
 */

export interface FolderFile {
  name: string;
}

export interface FolderLine {
  /** Cost code as filed, "26 20 00". */
  csi: string;
  /** Readable description from the file name. */
  description: string;
  amount: number;
  /** The file this line came from. */
  fileName: string;
}

const NAME = /^(\d{2} \d{2} \d{2}) - (\d[\d,]*(?:\.\d{1,2})?) - (.+?)(?:\.[A-Za-z0-9]{2,5})?$/;

/** "relay_and_flex_conduit_from_all_phase" → "Relay and flex conduit from all phase". */
export function readableDescription(raw: string): string {
  const t = raw.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function parseFolderFileName(name: string): FolderLine | null {
  const m = NAME.exec(name.trim());
  if (!m) return null;
  const amount = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { csi: m[1], description: readableDescription(m[3]), amount, fileName: name };
}

/** Round to cents so a long sum never prints 5062.160000001. */
const cents = (n: number) => Math.round(n * 100) / 100;

export function buildFolderBill(files: FolderFile[]): {
  lines: FolderLine[];
  total: number;
  /** File names that did not match the pattern — never silently dropped. */
  skipped: string[];
} {
  const lines: FolderLine[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const line = parseFolderFileName(f.name);
    if (line) lines.push(line);
    else skipped.push(f.name);
  }
  // Same order every time, whatever order Drive listed them in.
  lines.sort((a, b) => a.csi.localeCompare(b.csi) || a.fileName.localeCompare(b.fileName));
  return { lines, total: cents(lines.reduce((s, l) => s + l.amount, 0)), skipped };
}

/** M/D/YY from an ISO date, the way the filed documents title themselves. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : iso;
}
