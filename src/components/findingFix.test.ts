import { describe, expect, it } from "vitest";

import { fixTarget } from "./findingFix";

const bill = { source: "invoice-review", kind: "qbo-never-approved", key: "qbo-never-approved|22Job|22Bill" };
const todo = { source: "digest", kind: "jobtread-todos", key: "jobtread-todos::task:22Task" };

describe("fixTarget", () => {
  it("reads the bill id from an invoice-review or pre-send key", () => {
    expect(fixTarget(bill)).toEqual({ action: "approve-bill", docId: "22Bill" });
    expect(fixTarget({ ...bill, source: "pre-send" })).toEqual({ action: "approve-bill", docId: "22Bill" });
  });

  it("reads the task id from a digest key", () => {
    expect(fixTarget(todo)).toEqual({ action: "complete-todo", taskId: "22Task" });
  });

  it("prefers a structured fixAction", () => {
    expect(fixTarget({ ...bill, fixAction: "approve-bill:22Other" })).toEqual({ action: "approve-bill", docId: "22Other" });
    expect(fixTarget({ ...bill, fixAction: "22Other" })).toEqual({ action: "approve-bill", docId: "22Other" });
    expect(fixTarget({ ...todo, fixAction: "complete-todo:task:9" })).toEqual({ action: "complete-todo", taskId: "9" });
    expect(fixTarget({ ...todo, fixAction: "task:9" })).toEqual({ action: "complete-todo", taskId: "9" });
    expect(fixTarget({ ...bill, fixAction: "complete-todo:9" })).toBeNull();
  });

  it("offers nothing on other kinds or junk", () => {
    expect(fixTarget({ ...bill, kind: "qbo-not-pushed" })).toBeNull();
    expect(fixTarget({ ...bill, source: "digest" })).toBeNull();
    expect(fixTarget({ ...bill, key: "qbo-never-approved|22Job" })).toBeNull();
    expect(fixTarget({ ...bill, key: "qbo-never-approved|22Job|" })).toBeNull();
    expect(fixTarget({ ...bill, key: "qbo-never-approved|22Job|a b" })).toBeNull();
    expect(fixTarget({ ...todo, key: "jobtread-todos::title:order windows" })).toBeNull();
    expect(fixTarget({ ...todo, key: "" })).toBeNull();
  });
});
