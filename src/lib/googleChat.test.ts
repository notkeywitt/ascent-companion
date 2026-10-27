import { describe, expect, it } from "vitest";

import type { JobRef } from "./jobtread";
import { canAsk, matchJobs, parseEvent } from "./googleChat";

describe("parseEvent", () => {
  const user = { email: "Ty@AscentBuildingCo.com", displayName: "Ty" };

  it("reads an @mention as a question, without the mention itself", () => {
    expect(
      parseEvent({ type: "MESSAGE", user, message: { text: "@Assistant what's unbilled?", argumentText: " what's unbilled?" } }),
    ).toEqual({ kind: "question", email: "ty@ascentbuildingco.com", name: "Ty", text: "what's unbilled?" });
  });

  it("reads both slash-command shapes", () => {
    const old = parseEvent({ type: "MESSAGE", user, message: { argumentText: "Smith", slashCommand: { commandId: "1" } } });
    const neu = parseEvent({ type: "APP_COMMAND", user, appCommandMetadata: { appCommandId: 3 }, message: { argumentText: "Smith" } });
    expect(old).toMatchObject({ kind: "command", commandId: 1, arg: "Smith" });
    expect(neu).toMatchObject({ kind: "command", commandId: 3, arg: "Smith" });
  });

  it("ignores bots, empty messages and other event types", () => {
    expect(parseEvent({ type: "MESSAGE", user: { type: "BOT" }, message: { text: "hi" } }).kind).toBe("ignore");
    expect(parseEvent({ type: "MESSAGE", user, message: { text: "  " } }).kind).toBe("ignore");
    expect(parseEvent({ type: "REMOVED_FROM_SPACE" }).kind).toBe("ignore");
    expect(parseEvent(null).kind).toBe("ignore");
  });

  it("greets on being added to a space", () => {
    expect(parseEvent({ type: "ADDED_TO_SPACE" }).kind).toBe("added");
  });
});

describe("canAsk", () => {
  it("lets the pilot group ask, in any case, and no one else", () => {
    expect(canAsk("Casey@ascentbuildingco.com")).toBe(true);
    expect(canAsk("sam@ascentbuildingco.com")).toBe(false);
    expect(canAsk("keillor@ascentbuildingco.com.evil.com")).toBe(false);
    expect(canAsk("")).toBe(false);
    expect(canAsk(undefined)).toBe(false);
  });
});

describe("matchJobs", () => {
  const jobs: JobRef[] = [
    { id: "a", name: "Smith Kitchen", number: "12", customer: "Jane Smith" },
    { id: "b", name: "Smith Garage", number: "120" },
    { id: "c", name: "Berger Main House", number: "7", customer: "Kevin Berger" },
  ];

  it("prefers an exact job number", () => {
    expect(matchJobs(jobs, "12").map((j) => j.id)).toEqual(["a"]);
  });

  it("matches every typed word across name and customer", () => {
    expect(matchJobs(jobs, "smith").map((j) => j.id)).toEqual(["a", "b"]);
    expect(matchJobs(jobs, "smith garage").map((j) => j.id)).toEqual(["b"]);
    expect(matchJobs(jobs, "kevin").map((j) => j.id)).toEqual(["c"]);
  });

  it("matches nothing for an empty query", () => {
    expect(matchJobs(jobs, " ")).toEqual([]);
  });
});

describe("parseEvent, add-on app", () => {
  const user = { email: "tommy@ascentbuildingco.com", displayName: "Tommy" };

  it("reads a message, a command and being added", () => {
    expect(parseEvent({ chat: { user, messagePayload: { message: { argumentText: " over budget?" } } } })).toEqual({
      kind: "question",
      email: "tommy@ascentbuildingco.com",
      name: "Tommy",
      text: "over budget?",
    });
    expect(
      parseEvent({
        chat: { user, appCommandPayload: { appCommandMetadata: { appCommandId: 2 }, message: { argumentText: "" } } },
      }),
    ).toMatchObject({ kind: "command", commandId: 2, arg: "" });
    expect(parseEvent({ chat: { user, addedToSpacePayload: {} } }).kind).toBe("added");
    expect(parseEvent({ chat: { user } }).kind).toBe("ignore");
  });
});
