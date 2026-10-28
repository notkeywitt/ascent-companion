import { and, eq, like, or, sql } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { jobSources, specDocs } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { isReadable, type DriveItem, type ManualSource } from "@/lib/houseManual";
import { ocrScanWithClaude } from "@/lib/claudeExtract";
import { extractPdfLinks, extractPdfText } from "@/lib/pdfLinks";

/**
 * A job's Drive documents, read once so AscentBot can search them cheaply.
 *
 * The office pastes a Drive file or folder link on /specs. `walkDriveLink`
 * lists every file under it (subfolders too), and the page sends the files
 * back one at a time to `readDriveFile`, which fetches the PDF through the
 * Apps Script bridge (JobFiles.js) and keeps its TEXT LAYER and web links —
 * pdf.js, no model, so a read costs nothing. A scan has no text layer, so
 * Claude reads its words (`ocrScanWithClaude`), up to `OCR_MAX_PAGES`; a longer
 * scan is kept by name and link only. `searchSpecDocs` is the bot's read: a LIKE
 * filter in the DB, then the matching lines with their page.
 *
 * The links themselves are `job_sources`: ONE list per job that /specs and
 * /house-manual (Job files) both show and both add to.
 *
 * Read-only against Drive. Companion DB only. Server-only.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modified: string;
  /** The path under the linked folder, "" at its top. */
  folder: string;
}

export interface SpecDoc {
  id: number;
  driveId: string;
  name: string;
  folder: string;
  url: string;
  pages: number;
  chars: number;
  note: string;
  modified: string;
  importedAt: string;
}

/** A walk's ceilings. A job folder holds tens of files, not hundreds. */
const WALK_MAX_FILES = 300;
const WALK_MAX_FOLDERS = 40;
/** Text kept per document, about 100 dense pages. */
const TEXT_MAX = 400_000;
// ponytail: whole-scan OCR in one call must fit the route's 300s beside the
// 120s Drive fetch. A longer scan needs the read split into page ranges.
const OCR_MAX_PAGES = 10;
const OCR_TIMEOUT_MS = 150_000;
/** Claude takes 32 MB a request; base64 adds a third. */
const OCR_MAX_BYTES = 20_000_000;
/** The note on a scan that was not read. /specs reads such a file again on the next paste. */
export const SCAN_NOTE = "No text layer (a scan).";

/** OCR pages in the text layer's shape: "[Page N]", its lines, a blank line. */
export const scanText = (pages: string[]) =>
  pages
    .map((t, i) => [`[Page ${i + 1}]`, ...t.split("\n").map((l) => l.trim()).filter(Boolean), ""].join("\n"))
    .join("\n");

export const driveUrl = (id: string) => `https://drive.google.com/open?id=${encodeURIComponent(id)}`;

const list = (id: string) =>
  callAppsScriptOrThrow<{ item: DriveItem; children?: DriveItem[]; truncated?: boolean }>({
    action: "listDriveFolder",
    id,
  });

const fileOf = (i: DriveItem, folder: string): DriveFile => ({
  id: i.id,
  name: i.name,
  mimeType: i.mimeType,
  modified: i.modified,
  folder,
});

/** Every file under a Drive link, a folder level at a time. A file link is one file. */
export async function walkDriveLink(id: string): Promise<{ root: DriveItem; files: DriveFile[]; truncated: boolean }> {
  const top = await list(id);
  if (!top.item.isFolder) return { root: top.item, files: [fileOf(top.item, "")], truncated: false };
  const files: DriveFile[] = [];
  let truncated = !!top.truncated;
  let listed = 1;
  let level = [{ path: "", children: top.children ?? [] }];
  while (level.length) {
    const subs: { id: string; path: string }[] = [];
    for (const { path, children } of level) {
      for (const c of children) {
        if (c.isFolder) subs.push({ id: c.id, path: path ? `${path}/${c.name}` : c.name });
        else files.push(fileOf(c, path));
      }
    }
    const room = WALK_MAX_FOLDERS - listed;
    if (subs.length > room) truncated = true;
    const next = subs.slice(0, Math.max(room, 0));
    listed += next.length;
    level = await Promise.all(
      next.map(async (s) => {
        const r = await list(s.id);
        if (r.truncated) truncated = true;
        return { path: s.path, children: r.children ?? [] };
      }),
    );
  }
  if (files.length > WALK_MAX_FILES) truncated = true;
  return { root: top.item, files: files.slice(0, WALK_MAX_FILES), truncated };
}

/* ------------------------------------------------- the job's linked sources */

export interface JobSource extends ManualSource {
  /** When /specs last read it for AscentBot; "" = never. */
  readAt: string;
}

/** The job's linked Drive files and folders, folders first, by name. */
export async function listJobSources(jobId: string): Promise<JobSource[]> {
  await ensureDb();
  const rows = await db.select().from(jobSources).where(eq(jobSources.jobId, jobId));
  return rows
    .map((r) => ({ id: r.driveId, name: r.name, url: r.url, isFolder: r.isFolder, readAt: r.readAt }))
    .sort((a, b) => (a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.localeCompare(b.name)));
}

/** Link a Drive file or folder to the job. Already linked: its name and link are refreshed; `read` stamps readAt. */
export async function addJobSource(jobId: string, s: ManualSource, addedBy: string, read = false): Promise<void> {
  await ensureDb();
  const now = new Date().toISOString();
  const set = { name: s.name.slice(0, 300), url: s.url.slice(0, 500), isFolder: s.isFolder, ...(read ? { readAt: now } : {}) };
  await db
    .insert(jobSources)
    .values({ jobId, driveId: s.id, ...set, addedAt: now, addedBy })
    .onConflictDoUpdate({ target: [jobSources.jobId, jobSources.driveId], set });
}

/** Unlink one. The Drive file stays, and so does any text already read from it. */
export async function removeJobSource(jobId: string, driveId: string): Promise<void> {
  await ensureDb();
  await db.delete(jobSources).where(and(eq(jobSources.jobId, jobId), eq(jobSources.driveId, driveId)));
}

/** Read one Drive file and keep it as the job's document, replacing an earlier read. */
export async function readDriveFile(jobId: string, f: DriveFile, importedBy: string): Promise<SpecDoc> {
  let text = "";
  let pages = 0;
  let note = "";
  let modified = f.modified;
  if (!isReadable(f.mimeType)) {
    note = "Not read: only PDFs and Google Docs, Sheets and Slides are read. AscentBot sees its name and link.";
  } else {
    try {
      const pdf = await callAppsScriptOrThrow<{ data: string }>(
        { action: "getDriveFilePdf", id: f.id },
        { timeoutMs: 120_000 },
      );
      const bytes = new Uint8Array(Buffer.from(pdf.data, "base64"));
      const read = await extractPdfText(bytes);
      const links = await extractPdfLinks(bytes);
      pages = read.pages;
      let body = read.text.replace(/\[Page \d+\]/g, "").trim() ? read.text : "";
      if (!body) {
        if (pages > OCR_MAX_PAGES || bytes.length > OCR_MAX_BYTES) {
          note = `A scan of ${pages} pages, too long to read for text. AscentBot sees its name and link.`;
        } else {
          try {
            body = scanText(await ocrScanWithClaude(Buffer.from(bytes), OCR_TIMEOUT_MS));
            note = "A scan, read by OCR. Check key numbers against the file.";
          } catch (e) {
            note = `${SCAN_NOTE} OCR failed: ${e instanceof Error ? e.message : e}. AscentBot sees its name and link.`;
          }
        }
      }
      const linkLines = links.map((l) => `${l.text || l.context || "link"} — ${l.url}`);
      text = [body, linkLines.length ? `[Links]\n${linkLines.join("\n")}` : ""]
        .filter(Boolean)
        .join("\n")
        .slice(0, TEXT_MAX);
    } catch (e) {
      note = e instanceof Error ? e.message : String(e);
      modified = ""; // read again next time
    }
  }
  const values = {
    name: f.name.slice(0, 300),
    folder: f.folder.slice(0, 300),
    mimeType: f.mimeType.slice(0, 120),
    modified,
    pages,
    text,
    note,
    importedAt: new Date().toISOString(),
    importedBy,
  };
  await ensureDb();
  const [row] = await db
    .insert(specDocs)
    .values({ jobId, driveId: f.id, ...values })
    .onConflictDoUpdate({ target: [specDocs.jobId, specDocs.driveId], set: values })
    .returning({ id: specDocs.id });
  return { id: row.id, driveId: f.id, url: driveUrl(f.id), chars: text.length, ...values };
}

const META = {
  id: specDocs.id,
  driveId: specDocs.driveId,
  name: specDocs.name,
  folder: specDocs.folder,
  pages: specDocs.pages,
  chars: sql<number>`length(${specDocs.text})`,
  note: specDocs.note,
  modified: specDocs.modified,
  importedAt: specDocs.importedAt,
};

/** The job's documents, by folder then name. No text. */
export async function listSpecDocs(jobId: string): Promise<SpecDoc[]> {
  await ensureDb();
  const rows = await db
    .select(META)
    .from(specDocs)
    .where(eq(specDocs.jobId, jobId))
    .orderBy(specDocs.folder, specDocs.name);
  return rows.map((r) => ({ ...r, url: driveUrl(r.driveId) }));
}

export async function removeSpecDoc(jobId: string, id: number): Promise<void> {
  await ensureDb();
  await db.delete(specDocs).where(and(eq(specDocs.jobId, jobId), eq(specDocs.id, id)));
}

/** One page of a document's text, "" when it has no such page. */
export function pageText(text: string, page: number): string {
  const head = `[Page ${page}]\n`;
  const at = `\n${text}`.indexOf(`\n${head}`);
  if (at < 0) return "";
  const rest = text.slice(at + head.length);
  const end = rest.search(/\n\[(Page \d+|Links)\]\n/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/**
 * The lines of `text` holding ANY of `words` (lowercase), each with the line
 * before and after it and the page it sits on (0 = the links list). `hits`
 * counts every matching line; at most `max` snippets come back.
 */
export function findSnippets(
  text: string,
  words: string[],
  max = 4,
): { hits: number; snippets: { page: number; text: string }[] } {
  const lines = text.split("\n");
  const isHead = (l: string) => /^\[(Page \d+|Links)\]$/.test(l);
  const snippets: { page: number; text: string }[] = [];
  let page = 0;
  let hits = 0;
  let last = -2;
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^\[(?:Page (\d+)|Links)\]$/);
    if (head) {
      page = head[1] ? Number(head[1]) : 0;
      continue;
    }
    const l = lines[i].toLowerCase();
    if (!words.some((w) => l.includes(w))) continue;
    hits++;
    if (snippets.length >= max || i <= last + 1) continue;
    const around = [lines[i - 1], lines[i], lines[i + 1]].filter((x) => x !== undefined && x.trim() && !isHead(x));
    snippets.push({ page, text: around.join(" | ").slice(0, 320) });
    last = i + 1;
  }
  return { hits, snippets };
}

/**
 * AscentBot's read. With `docId`: one page of that document. With words: the
 * documents that mention any of them, best first, with matching lines. With
 * neither: the list.
 */
export async function searchSpecDocs(jobId: string, words: string[], docId = 0, page = 1) {
  await ensureDb();
  if (docId) {
    const [row] = await db
      .select()
      .from(specDocs)
      .where(and(eq(specDocs.jobId, jobId), eq(specDocs.id, docId)))
      .limit(1);
    if (!row) return { error: "No such document on this job." };
    return {
      name: row.name,
      url: driveUrl(row.driveId),
      pages: row.pages,
      page,
      text: pageText(row.text, page).slice(0, 8000) || "(no text on that page)",
    };
  }
  const clean = words.map((w) => w.replace(/[%_]/g, "")).filter(Boolean);
  if (!clean.length) {
    const docs = await listSpecDocs(jobId);
    return {
      count: docs.length,
      documents: docs.slice(0, 100).map((d) => ({
        document_id: d.id,
        name: d.name,
        ...(d.folder ? { folder: d.folder } : {}),
        pages: d.pages,
        url: d.url,
        ...(d.note ? { note: d.note } : {}),
      })),
    };
  }
  const match = or(...clean.flatMap((w) => [like(specDocs.text, `%${w}%`), like(specDocs.name, `%${w}%`)]));
  const rows = await db
    .select({ id: specDocs.id, driveId: specDocs.driveId, name: specDocs.name, folder: specDocs.folder, pages: specDocs.pages, text: specDocs.text })
    .from(specDocs)
    .where(and(eq(specDocs.jobId, jobId), match));
  const ranked = rows
    .map((r) => ({ r, ...findSnippets(r.text, clean) }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 8);
  return {
    matched: rows.length,
    documents: ranked.map(({ r, hits, snippets }) => ({
      document_id: r.id,
      name: r.name,
      ...(r.folder ? { folder: r.folder } : {}),
      pages: r.pages,
      url: driveUrl(r.driveId),
      hits,
      snippets,
    })),
  };
}
