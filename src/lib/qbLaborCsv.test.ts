import { describe, expect, it } from "vitest";
import { QB_LABOR_HEADERS, buildQbLaborCsv, type QbLaborEntry } from "@/lib/qbLaborCsv";

const job = { name: "Main House", customer: "Berger" };

const entry = (over: Partial<QbLaborEntry>): QbLaborEntry => ({
  employee: "Cedar",
  // 2026-07-22 15:30Z == 08:30 Pacific (PDT, UTC-7).
  startedAt: "2026-07-22T15:30:00.000Z",
  endedAt: "2026-07-22T23:00:00.000Z", // 16:00 Pacific
  hours: 7.5,
  code: "01 31 20",
  codeName: "Project Management",
  notes: "framing",
  isApproved: true,
  ...over,
});

function parse(csv: string): string[][] {
  return csv.split("\r\n").map((line) => {
    const out: string[] = [];
    let field = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        out.push(field);
        field = "";
      } else field += c;
    }
    out.push(field);
    return out;
  });
}

describe("buildQbLaborCsv", () => {
  it("emits the QuickBooks header row", () => {
    const rows = parse(buildQbLaborCsv([], job));
    expect(rows[0]).toEqual([...QB_LABOR_HEADERS]);
  });

  it("converts JobTread UTC instants to the org's Pacific wall clock", () => {
    const [, row] = parse(buildQbLaborCsv([entry({})], job));
    const h = QB_LABOR_HEADERS;
    const cell = (name: (typeof QB_LABOR_HEADERS)[number]) => row[h.indexOf(name)];
    // 15:30Z is 08:30 Pacific in July — NOT 15:30 a raw slice would give.
    expect(cell("local_date")).toBe("2026-07-22");
    expect(cell("local_start_time")).toBe("08:30:00");
    expect(cell("local_end_time")).toBe("16:00:00");
  });

  it("maps job → jobcode_1/jobcode_2, code+name → service item, approval → status", () => {
    const [, row] = parse(buildQbLaborCsv([entry({})], job));
    const h = QB_LABOR_HEADERS;
    const cell = (name: (typeof QB_LABOR_HEADERS)[number]) => row[h.indexOf(name)];
    expect(cell("jobcode_1")).toBe("Berger");
    expect(cell("jobcode_2")).toBe("Main House");
    expect(cell("service item")).toBe("01 31 20 Project Management");
    expect(cell("hours")).toBe("7.50");
    expect(cell("approved_status")).toBe("Approved");
  });

  it("splits a display name into fname/lname and keeps the full name as username", () => {
    const [, a] = parse(buildQbLaborCsv([entry({ employee: "Ty O'Steen" })], job));
    const h = QB_LABOR_HEADERS;
    expect(a[h.indexOf("username")]).toBe("Ty O'Steen");
    expect(a[h.indexOf("fname")]).toBe("Ty");
    expect(a[h.indexOf("lname")]).toBe("O'Steen");
    const [, b] = parse(buildQbLaborCsv([entry({ employee: "Cedar" })], job));
    expect(b[h.indexOf("fname")]).toBe("Cedar");
    expect(b[h.indexOf("lname")]).toBe("");
  });

  it("marks unapproved entries and leaves the end blank for a running entry", () => {
    const [, row] = parse(
      buildQbLaborCsv([entry({ isApproved: false, endedAt: null })], job),
    );
    const h = QB_LABOR_HEADERS;
    expect(row[h.indexOf("approved_status")]).toBe("Not Approved");
    expect(row[h.indexOf("local_end_time")]).toBe("");
  });

  it("quotes fields with commas and sorts rows oldest-first", () => {
    const csv = buildQbLaborCsv(
      [
        entry({ startedAt: "2026-07-23T15:00:00.000Z", notes: "later" }),
        entry({ startedAt: "2026-07-21T15:00:00.000Z", notes: "earlier, and quoted" }),
      ],
      job,
    );
    const rows = parse(csv);
    const notesIdx = QB_LABOR_HEADERS.indexOf("notes");
    expect(rows[1][notesIdx]).toBe("earlier, and quoted");
    expect(rows[2][notesIdx]).toBe("later");
    expect(csv).toContain('"earlier, and quoted"');
  });
});
