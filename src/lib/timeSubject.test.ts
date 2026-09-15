import { describe, expect, it } from "vitest";

import { decideTimeSubject } from "./timeSubject";

/**
 * WHOSE TIME A REQUEST MAY TOUCH. This is the whole of the rule that lets an
 * admin open Dan's timesheet and stops everyone else doing the same — so it is
 * tested as a rule, not as a route.
 *
 * The case that matters most is the middle one. Before this existed, `userId`
 * went from the request body straight to `createTimeEntry`, so any signed-in
 * employee could log hours against any colleague by changing one field. The
 * unlinked-person exception is why it was ever loose, and it is kept on purpose.
 */

const DAN = "22_dan";
const ME = "22_me";

describe("decideTimeSubject", () => {
  it("lets anyone act as themselves", () => {
    expect(decideTimeSubject({ requested: ME, ownJtUserId: ME, role: "field" })).toEqual({
      subject: ME,
      acting: false,
    });
  });

  it("defaults to your own JobTread user when none is asked for", () => {
    expect(decideTimeSubject({ requested: "", ownJtUserId: ME, role: "field" })).toEqual({
      subject: ME,
      acting: false,
    });
  });

  it("REFUSES a linked non-admin asking for someone else", () => {
    // The hole this closes: a field phone posting { userId: "<Dan>" }.
    for (const role of ["field", "lead", "office", ""]) {
      expect(decideTimeSubject({ requested: DAN, ownJtUserId: ME, role })).toEqual({
        error: "You can only log and edit your own time.",
        status: 403,
      });
    }
  });

  it("lets an admin act as someone else, and marks it", () => {
    expect(decideTimeSubject({ requested: DAN, ownJtUserId: ME, role: "admin" })).toEqual({
      subject: DAN,
      acting: true,
    });
  });

  it("does not mark an admin acting as themselves", () => {
    // Otherwise every admin's own clock-in would journal as an impersonation.
    expect(decideTimeSubject({ requested: ME, ownJtUserId: ME, role: "admin" })).toEqual({
      subject: ME,
      acting: false,
    });
  });

  it("still lets an UNLINKED person identify themselves, as before", () => {
    // No link means no "own" to compare against — this is the one-time "who are
    // you in JobTread?" pick, not impersonation. An admin closes it for good by
    // linking them on the Employees page.
    expect(decideTimeSubject({ requested: DAN, ownJtUserId: "", role: "field" })).toEqual({
      subject: DAN,
      acting: false,
    });
  });

  it("asks an unlinked person with no pick to say who they are", () => {
    expect(decideTimeSubject({ requested: "", ownJtUserId: "", role: "admin" })).toMatchObject({
      status: 400,
    });
  });

  it("ignores whitespace on both sides", () => {
    expect(decideTimeSubject({ requested: `  ${ME}  `, ownJtUserId: ME, role: "field" })).toEqual({
      subject: ME,
      acting: false,
    });
    expect(decideTimeSubject({ requested: "   ", ownJtUserId: ME, role: "field" })).toEqual({
      subject: ME,
      acting: false,
    });
  });
});
