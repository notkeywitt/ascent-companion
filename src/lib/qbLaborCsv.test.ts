import { describe, expect, it } from "vitest";
import {
  QB_LABOR_HEADERS,
  buildQbLaborCsv,
  buildQbLaborRows,
  type QbLaborEntry,
} from "@/lib/qbLaborCsv";

const entry = (over: Partial<QbLaborEntry>): QbLaborEntry => ({
  employee: "Cedar",
  username: "ccharnley",
  // 2026-07-22 15:30Z == 08:30 Pacific (PDT, UTC-7).
  startedAt: "2026-07-22T15:30:00.000Z",
  endedAt: "2026-07-22T23:00:00.000Z", // 16:00 Pacific
  hours: 7.5,
  code: "01 31 20",
  codeName: "Project Management",
  notes: "framing",
  isApproved: true,
  customer: "Berger",
  jobName: "Main House",
  ...over,
});

const h = QB_LABOR_HEADERS;
const cell = (row: string[], name: (typeof QB_LABOR_HEADERS)[number]) => row[h.indexOf(name)];

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

describe("buildQbLaborRows", () => {
  it("emits the 23-column QuickBooks Time header row", () => {
    expect(buildQbLaborRows([])).toEqual([[...QB_LABOR_HEADERS]]);
    expect(QB_LABOR_HEADERS).toHaveLength(23);
  });

  it("converts JobTread UTC instants to the org's Pacific wall clock", () => {
    const [, row] = buildQbLaborRows([entry({})]);
    // 15:30Z is 08:30 Pacific in July — NOT 15:30 a raw slice would give.
    expect(cell(row, "local_date")).toBe("2026-07-22");
    expect(cell(row, "local_day")).toBe("Wed");
    expect(cell(row, "local_start_time")).toBe("2026-07-22 08:30:00");
    expect(cell(row, "local_end_time")).toBe("2026-07-22 16:00:00");
    expect(cell(row, "tz")).toBe("-7");
  });

  it("reports the winter offset for a January entry", () => {
    const [, row] = buildQbLaborRows([entry({ startedAt: "2026-01-22T17:30:00.000Z", endedAt: null })]);
    expect(cell(row, "tz")).toBe("-8");
    expect(cell(row, "local_start_time")).toBe("2026-01-22 09:30:00");
  });

  it("maps the job → jobcode_1/jobcode_2, the code → service item, approval → status", () => {
    const [, row] = buildQbLaborRows([entry({})]);
    expect(cell(row, "jobcode_1")).toBe("Berger");
    expect(cell(row, "jobcode_2")).toBe("Main House");
    expect(cell(row, "jobcode_3")).toBe("");
    expect(cell(row, "service item")).toBe("01 31 20");
    expect(cell(row, "hours")).toBe("7.50");
    expect(cell(row, "approved_status")).toBe("approved");
    expect(cell(row, "number")).toBe("0");
  });

  it("leaves every column JobTread has no field for blank", () => {
    const [, row] = buildQbLaborRows([entry({})]);
    for (const col of ["payroll_id", "group", "billable", "class", "location", "has_flags", "flag_types"] as const) {
      expect(cell(row, col)).toBe("");
    }
  });

  it("uses the email as username and splits the display name into fname/lname", () => {
    const [, a] = buildQbLaborRows([
      entry({ employee: "Ty O'Steen", username: "tylerosteen@gmail.com" }),
    ]);
    expect(cell(a, "username")).toBe("tylerosteen@gmail.com");
    expect(cell(a, "fname")).toBe("Ty");
    expect(cell(a, "lname")).toBe("O'Steen");
    // No email on the entry ⇒ the display name stands in.
    const [, b] = buildQbLaborRows([entry({ employee: "Cedar", username: "" })]);
    expect(cell(b, "username")).toBe("Cedar");
    expect(cell(b, "lname")).toBe("");
  });

  it("marks unapproved entries and leaves the end blank for a running entry", () => {
    const [, row] = buildQbLaborRows([entry({ isApproved: false, endedAt: null })]);
    expect(cell(row, "approved_status")).toBe("unapproved");
    expect(cell(row, "local_end_time")).toBe("");
  });

  it("groups rows by employee, oldest-first within each", () => {
    const rows = buildQbLaborRows([
      entry({ employee: "Wyatt", startedAt: "2026-07-21T15:00:00.000Z" }),
      entry({ employee: "Cedar", startedAt: "2026-07-23T15:00:00.000Z", notes: "later" }),
      entry({ employee: "Cedar", startedAt: "2026-07-21T15:00:00.000Z", notes: "earlier" }),
    ]);
    expect(rows.slice(1).map((r) => [cell(r, "fname"), cell(r, "notes")])).toEqual([
      ["Cedar", "earlier"],
      ["Cedar", "later"],
      ["Wyatt", "framing"],
    ]);
  });
});

describe("buildQbLaborCsv", () => {
  it("quotes fields carrying a comma", () => {
    const csv = buildQbLaborCsv([entry({ notes: "orders, research" })]);
    expect(csv).toContain('"orders, research"');
    const rows = parse(csv);
    expect(rows[0]).toEqual([...QB_LABOR_HEADERS]);
    expect(cell(rows[1], "notes")).toBe("orders, research");
  });
});
