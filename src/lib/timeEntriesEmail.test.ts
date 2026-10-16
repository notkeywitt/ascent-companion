import { describe, expect, it } from "vitest";
import type { ExportTimeEntry } from "./jobtread";
import { composeTimeEntriesEmail, payPeriod, timeEntriesCsv } from "./timeEntriesEmail";

const entry = (over: Partial<ExportTimeEntry>): ExportTimeEntry => ({
  id: "E1",
  startedAt: "2026-10-15T15:30:00.000Z",
  endedAt: "2026-10-15T23:30:00.000Z",
  minutes: 480,
  isApproved: true,
  type: "Regular Pay",
  notes: "",
  userName: "Alex",
  userEmail: "alex@example.com",
  customer: "Client",
  location: "1 Main St",
  locationCountry: "US",
  locationState: "WA",
  jobName: "House",
  itemName: "Rough Carpentry",
  itemGroup: "Rough Carpentry",
  codeNumber: "06 10 00",
  codeName: "Rough Carpentry",
  comments: [],
  ...over,
});

const HEADER =
  '"ID",User,User Email,Type,Start,End,Hours (HH:MM),Hours (Decimal),Approved,Customer,Location,' +
  "Location: Country,Location: State,Job,Item,Item Group,Code,Notes,Comments";

describe("timeEntriesCsv", () => {
  it("writes JobTread's layout: BOM, quoted ID header, LF rows, final LF", () => {
    const csv = timeEntriesCsv([entry({})]);
    expect(csv).toBe(
      "﻿" +
        HEADER +
        "\n" +
        "E1,Alex,alex@example.com,Regular Pay,2026-10-15 08:30,2026-10-15 16:30,8:00,8,true," +
        "Client,1 Main St,US,WA,House,Rough Carpentry,Rough Carpentry,06 10 00 Rough Carpentry,,\n",
    );
  });

  it("quotes only the cells that need it", () => {
    const row = timeEntriesCsv([entry({ notes: 'Deck, "rail"\nposts', itemGroup: "06 Wood, Plastics" })])
      .split("\n")
      .slice(1)
      .join("\n");
    expect(row).toContain(',"06 Wood, Plastics",');
    expect(row).toContain(',"Deck, ""rail""\nposts",');
  });

  it("writes hours from JobTread's minutes, with JavaScript's own decimal", () => {
    const row = timeEntriesCsv([entry({ minutes: 125 })]).split("\n")[1].split(",");
    expect(row[6]).toBe("2:05");
    expect(row[7]).toBe("2.0833333333333335");
  });

  it("drops seconds rather than rounding, and writes the org's wall clock by default", () => {
    const row = timeEntriesCsv([
      entry({ startedAt: "2026-10-01T15:59:58.000Z", endedAt: "2026-10-01T17:34:04.368Z" }),
    ])
      .split("\n")[1]
      .split(",");
    expect(row[4]).toBe("2026-10-01 08:59");
    expect(row[5]).toBe("2026-10-01 10:34");
  });

  it("can write another zone's wall clock — JobTread's export uses the browser's", () => {
    const row = timeEntriesCsv([entry({})], "America/New_York").split("\n")[1].split(",");
    expect(row[4]).toBe("2026-10-15 11:30");
  });

  it("orders newest start first, then by employee name", () => {
    const csv = timeEntriesCsv([
      entry({ id: "old", startedAt: "2026-10-01T15:00:00.000Z" }),
      entry({ id: "zed", userName: "Zed", startedAt: "2026-10-14T15:30:00.000Z" }),
      entry({ id: "amy", userName: "Amy", startedAt: "2026-10-14T15:30:00.000Z" }),
      entry({ id: "new", startedAt: "2026-10-15T15:00:00.000Z" }),
    ]);
    expect(csv.split("\n").slice(1, 5).map((r) => r.split(",")[0])).toEqual(["new", "amy", "zed", "old"]);
  });

  it("leaves an empty group, a running clock and no code blank", () => {
    const row = timeEntriesCsv([
      entry({ itemGroup: "", endedAt: null, minutes: 0, codeNumber: "", codeName: "", isApproved: false }),
    ])
      .split("\n")[1]
      .split(",");
    expect(row[5]).toBe("");
    expect(row[8]).toBe("false");
    expect(row[15]).toBe("");
    expect(row[16]).toBe("");
  });

  it("writes a cost code whose number is a word the way JobTread does", () => {
    const row = timeEntriesCsv([entry({ codeNumber: "Office Admin", codeName: "Office Admin" })])
      .split("\n")[1]
      .split(",");
    expect(row[16]).toBe("Office Admin Office Admin");
  });
});

describe("payPeriod", () => {
  it("bounds each half at org midnight", () => {
    const a = payPeriod("2026-10", "a")!;
    expect([a.start, a.end, a.sinceIso, a.untilIso]).toEqual([
      "2026-10-01",
      "2026-10-15",
      "2026-10-01T07:00:00.000Z",
      "2026-10-16T07:00:00.000Z",
    ]);
    const b = payPeriod("2026-10", "b")!;
    expect([b.start, b.end, b.untilIso]).toEqual(["2026-10-16", "2026-10-31", "2026-11-01T07:00:00.000Z"]);
  });

  it("rolls December into January and knows February's length", () => {
    expect(payPeriod("2026-12", "b")!.untilIso).toBe("2027-01-01T08:00:00.000Z");
    expect(payPeriod("2027-02", "b")!.end).toBe("2027-02-28");
  });

  it("refuses a malformed month", () => {
    expect(payPeriod("2026-13", "a")).toBeNull();
    expect(payPeriod("Oct", "a")).toBeNull();
  });
});

describe("composeTimeEntriesEmail", () => {
  it("says what the Oct 1-15 email said", () => {
    const e = composeTimeEntriesEmail(payPeriod("2026-10", "a")!, "2026-10-16");
    expect(e.subject).toBe("Oct 1-15 Time Entries");
    expect(e.text.startsWith("Hi Sara,\n\nOur time cards for the first half of October are attached, thanks!")).toBe(
      true,
    );
    expect(e.html).toContain("Our time cards for the first half of October are attached, thanks!");
    expect(e.html).toContain("-Keillor");
    expect(e.fileName).toBe("time-entries-2026-10-16.csv");
  });

  it("names the second half by the month's last day", () => {
    const e = composeTimeEntriesEmail(payPeriod("2026-11", "b")!, "2026-12-01");
    expect(e.subject).toBe("Nov 16-30 Time Entries");
    expect(e.text).toContain("second half of November");
  });
});
