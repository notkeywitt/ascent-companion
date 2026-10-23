import { PDFDocument, PDFName, PDFTextField, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { EMPTY_PROFILE, configFor, groupKey } from "./fields";
import { fillForm, mergePdfs, profileSheet, readPdfFields, winAnsi } from "./pdf";

// A 1x1 transparent PNG stands in for a drawn signature.
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
);

async function template(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const add = (name: string, tip: string, y: number) => {
    const f = form.createTextField(name);
    f.acroField.dict.set(PDFName.of("TU"), doc.context.obj(tip) as never);
    f.addToPage(page, { x: 50, y, width: 300, height: 20 });
    return f;
  };
  add("first", "First name", 700);
  add("ssn", "Social security number", 660);
  add("employer", "Employer's name and address", 620);
  add("sig", "Signature of Employee", 580);
  add("dated", "Today's Date", 540);
  for (const [n, y] of [["Checking", 500], ["Savings", 470]] as const) {
    form.createCheckBox(n).addToPage(page, { x: 50, y, width: 12, height: 12 });
  }
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  return doc.save();
}

describe("readPdfFields + fillForm", () => {
  it("fills the hire's answers, leaves the office's field open, and adds the signature record", async () => {
    const bytes = await template();
    const info = await readPdfFields(bytes);
    expect(info.fields.map((f) => f.name)).toEqual(["first", "ssn", "employer", "sig", "dated", "Checking", "Savings"]);

    const fields = configFor(info.fields).map((f) =>
      f.kind === "check" ? { ...f, group: "Type of account" } : f,
    );
    expect(fields.find((f) => f.name === "employer")?.role).toBe("office");
    expect(fields.find((f) => f.name === "sig")?.kind).toBe("signature");

    const out = await fillForm({
      template: bytes,
      formName: "Test form",
      fields,
      answers: { first: "Ana", ssn: "123-45-6789", employer: "should not be written", [groupKey("Type of account")]: "Savings" },
      profile: { ...EMPTY_PROFILE, firstName: "Ana" },
      ssn: "",
      signaturePng: PNG,
      signer: { name: "Ana Ruiz", email: "ana@example.com", ip: "1.2.3.4", userAgent: "test", at: new Date("2026-10-20T18:00:00Z") },
    });

    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    const text = (n: string) => (form.getField(n) as PDFTextField).getText() ?? "";
    expect(text("first")).toBe("Ana");
    expect(text("ssn")).toBe("123-45-6789");
    expect(text("employer")).toBe("");
    expect(form.getField("employer").isReadOnly()).toBe(false);
    expect(form.getField("first").isReadOnly()).toBe(true);
    expect(text("dated")).toBe("10/20/2026");
    expect(form.getCheckBox("Savings").isChecked()).toBe(true);
    expect(form.getCheckBox("Checking").isChecked()).toBe(false);
    // The signature field is painted onto the page and removed.
    expect(() => form.getField("sig")).toThrow();
    expect(doc.getPageCount()).toBe(2);
  });

  it("refuses a file that is not a PDF", async () => {
    await expect(readPdfFields(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a PDF/);
  });
});

describe("packet", () => {
  it("merges the profile page with the signed forms", async () => {
    const sheet = await profileSheet({ ...EMPTY_PROFILE, firstName: "Ana", lastName: "Ruiz" }, {
      position: "Carpenter",
      hireDate: "2026-11-02",
      invitedAt: "",
      profileAt: "2026-10-20T18:00:00Z",
    });
    const merged = await PDFDocument.load(await mergePdfs([sheet, await template()]));
    expect(merged.getPageCount()).toBe(2);
  });
});

describe("winAnsi", () => {
  it("keeps Latin-1, folds accents it cannot write, and never throws", () => {
    expect(winAnsi("José Núñez")).toBe("José Núñez");
    expect(winAnsi("Ćwik Đặng")).toBe("Cwik ?ang");
    expect(winAnsi("名前")).toBe("??");
  });
});
