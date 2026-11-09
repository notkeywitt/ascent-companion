import { describe, expect, it } from "vitest";

import { mergeRemoteNote } from "./clockNoteSync";

describe("mergeRemoteNote", () => {
  it("takes JobTread's note when nothing was typed here since the last sync", () => {
    expect(mergeRemoteNote("Framing", "Framing", "Framing, then trim")).toBe("Framing, then trim");
  });

  it("keeps this box when JobTread has not changed", () => {
    expect(mergeRemoteNote("Framing, then trim", "Framing", "Framing")).toBe("Framing, then trim");
  });

  it("fills an empty box from JobTread on a device that never knew the note", () => {
    expect(mergeRemoteNote("", null, "Set forms")).toBe("Set forms");
  });

  it("keeps a typed box when JobTread holds nothing", () => {
    expect(mergeRemoteNote("Set forms", null, "")).toBe("Set forms");
  });

  it("propagates a cleared note when this box was unchanged", () => {
    expect(mergeRemoteNote("Set forms", "Set forms", "")).toBe("");
  });

  it("puts text added here on the end of JobTread's newer note", () => {
    expect(mergeRemoteNote("Demo. Hauled debris", "Demo.", "Demo. Framed wall")).toBe("Demo. Framed wall Hauled debris");
  });

  it("keeps both notes, JobTread's first, when they share nothing", () => {
    expect(mergeRemoteNote("Hauled debris", null, "Framed wall")).toBe("Framed wall\nHauled debris");
  });

  it("does not duplicate a note one side already extends", () => {
    expect(mergeRemoteNote("Framed wall, sheathing", null, "Framed wall")).toBe("Framed wall, sheathing");
    expect(mergeRemoteNote("Framed wall", null, "Framed wall, sheathing")).toBe("Framed wall, sheathing");
  });
});

describe("mergeRemoteNote — trailing space", () => {
  it("does not treat a trimmed copy of the same note as an edit", () => {
    expect(mergeRemoteNote("Framed wall ", "Framed wall ", "Framed wall")).toBe("Framed wall ");
  });
});
