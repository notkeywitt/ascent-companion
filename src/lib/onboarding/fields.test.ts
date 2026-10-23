import { describe, expect, it } from "vitest";

import {
  EMPTY_PROFILE,
  cleanConfig,
  cleanProfile,
  configFor,
  groupKey,
  guessField,
  missingAnswers,
  prefillValues,
  questionsFor,
  rosterAddress,
  type RawField,
} from "./fields";

const raw = (name: string, tooltip = "", kind: RawField["kind"] = "text", page = 0): RawField => ({ name, tooltip, kind, page });

describe("guessField", () => {
  it("pre-fills a W-4 style field from its tooltip", () => {
    expect(guessField(raw("f1_01[0]", "Step 1(a). First name and middle initial."))?.prefill).toBe("firstMi");
    expect(guessField(raw("f1_02[0]", "Last name."))?.prefill).toBe("lastName");
    expect(guessField(raw("f1_05[0]", "Social security number."))?.prefill).toBe("ssn");
    expect(guessField(raw("x", "City or town, state, and ZIP code."))?.prefill).toBe("cityStateZip");
    expect(guessField(raw("x", "Employee's E-mail Address"))?.prefill).toBe("email");
    expect(guessField(raw("x", "Date of Birth mm/dd/yyyy"))?.prefill).toBe("birthday");
  });

  it("gives the employer's section to the office", () => {
    const f = guessField(raw("f1_13[0]", "Employer's name and address"));
    expect(f?.role).toBe("office");
    expect(f?.prefill).toBeUndefined();
    expect(guessField(raw("Document Title 1", "Section 2. List A. Document Title"))?.role).toBe("office");
  });

  it("does not take 'other last names' for the last name", () => {
    expect(guessField(raw("x", "Other Last Names Used (if any)"))?.prefill).toBeUndefined();
  });

  it("treats a text field named for a signature as the signature spot", () => {
    const f = guessField(raw("Signature of Employee", "Signature of Employee"));
    expect(f?.kind).toBe("signature");
    expect(f?.required).toBe(true);
    expect(guessField(raw("Signature of Employer or AR", ""))?.role).toBe("office");
  });

  it("skips push buttons", () => {
    expect(guessField(raw("Print", "", "skip"))).toBeNull();
  });
});

describe("configFor — the Direct Deposit preset", () => {
  const dd = [
    "1", "2", "City State Zip", "Name of Bank 1", "Name of Bank 2", "9Digit Routing", "undefined",
    "or", "the account listed above This authorization will remain in effect until I modify or cancel it in",
    "undefined_3",
  ].map((n) => raw(n));
  const checks = ["Checking", "Savings", "Entire Paycheck", "undefined_2.0", "undefined_2.1"].map((n) => raw(n, n, "check"));
  const cfg = configFor([...dd, ...checks]);
  const by = (n: string) => cfg.find((f) => f.name === n)!;

  it("names the fields the PDF leaves unnamed", () => {
    expect(by("1").label).toBe("Name");
    expect(by("Name of Bank 2").label).toBe("Account number");
    expect(by("undefined_3").prefill).toBe("today");
  });

  it("makes the company name a fixed value, not a question", () => {
    const f = by("the account listed above This authorization will remain in effect until I modify or cancel it in");
    expect(f.role).toBe("fixed");
    expect(f.value).toBe("Ascent Building Co.");
    expect(f.prefill).toBeUndefined();
  });

  it("asks Checking / Savings as one question", () => {
    const groups = questionsFor(cfg).filter((q) => q.type === "group");
    expect(groups.map((g) => g.type === "group" && g.title)).toEqual(["Type of account", "How much to deposit"]);
  });
});

describe("missingAnswers", () => {
  const cfg = configFor([raw("Name of Bank 1"), raw("9Digit Routing"), raw("Entire Paycheck", "", "check")]);
  it("lists required answers left empty", () => {
    const fields = cfg.map((f) => ({ ...f, required: f.name !== "Entire Paycheck" }));
    const label = (n: string) => fields.find((f) => f.name === n)!.label;
    expect(missingAnswers(fields, {})).toEqual([label("Name of Bank 1"), label("9Digit Routing")]);
    expect(missingAnswers(fields, { "Name of Bank 1": "First Bank", "9Digit Routing": "123456789" })).toEqual([]);
  });
  it("checks a required group by its group key", () => {
    const fields = [
      { name: "a", kind: "check" as const, label: "Checking", role: "employee" as const, page: 0, group: "Type", required: true },
      { name: "b", kind: "check" as const, label: "Savings", role: "employee" as const, page: 0, group: "Type" },
    ];
    expect(missingAnswers(fields, {})).toEqual(["Type"]);
    expect(missingAnswers(fields, { [groupKey("Type")]: "b" })).toEqual([]);
  });
});

describe("profile", () => {
  const p = cleanProfile({
    ...EMPTY_PROFILE,
    firstName: " Ana ",
    middleInitial: "m.",
    lastName: "Ruiz",
    street: "12 Main St",
    apt: "Apt 3",
    city: "Friday Harbor",
    state: "wa",
    zip: "98250",
    birthday: "1990-04-02",
    junk: "dropped",
  });

  it("keeps only known keys, trimmed", () => {
    expect(p.firstName).toBe("Ana");
    expect(p.state).toBe("WA");
    expect(p.middleInitial).toBe("M");
    expect("junk" in p).toBe(false);
  });

  it("joins the roster's one Address cell", () => {
    expect(rosterAddress(p)).toBe("12 Main St Apt 3, Friday Harbor, WA 98250");
  });

  it("formats prefills the way the forms ask", () => {
    const v = prefillValues(p, "2026-10-20", "123-45-6789");
    expect(v.firstMi).toBe("Ana M.");
    expect(v.fullName).toBe("Ana M. Ruiz");
    expect(v.birthday).toBe("04/02/1990");
    expect(v.today).toBe("10/20/2026");
    expect(v.cityStateZip).toBe("Friday Harbor, WA 98250");
    expect(v.ssn).toBe("123-45-6789");
  });
});

describe("cleanConfig", () => {
  const base = configFor([raw("a", "First name"), raw("b", "Checking", "check")]);
  it("keeps the office's edits and drops fields the PDF does not have", () => {
    const out = cleanConfig(
      [
        { name: "b", label: "Checking acct", role: "employee", group: "Type", kind: "signature" },
        { name: "zzz", label: "nope" },
        { name: "a", role: "fixed", value: "X", prefill: "bogus" },
      ],
      base,
    );
    expect(out.map((f) => f.name)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ role: "fixed", value: "X" });
    expect(out[0].prefill).toBeUndefined();
    expect(out[1]).toMatchObject({ label: "Checking acct", group: "Type", kind: "check" });
  });
});
