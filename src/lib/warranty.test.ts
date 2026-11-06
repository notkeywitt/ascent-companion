import { describe, expect, it } from "vitest";

import { isWarrantyInvoice, warrantyPart } from "./warranty";

const W = "88 90 00";

describe("isWarrantyInvoice", () => {
  it("is true for Seely #130: every line 88 90 00, priced $0", () => {
    expect(
      isWarrantyInvoice({
        price: 0,
        lines: [
          { code: W, cost: 978, price: 0 },
          { code: W, cost: 5550, price: 0 },
          { code: W, cost: 2260.81, price: 0 },
        ],
      }),
    ).toBe(true);
  });

  it("is false for a normal invoice", () => {
    expect(isWarrantyInvoice({ price: 1570.76, lines: [{ code: "01 31 10", cost: 90, price: 106.2 }] })).toBe(false);
  });

  it("is false when a $0 invoice carries a non-warranty line", () => {
    expect(
      isWarrantyInvoice({ price: 0, lines: [{ code: W, cost: 100, price: 0 }, { code: "06 10 00", cost: 50, price: 0 }] }),
    ).toBe(false);
  });

  it("is false when the warranty work is billed to the client", () => {
    expect(isWarrantyInvoice({ price: 500, lines: [{ code: W, cost: 400, price: 500 }] })).toBe(false);
  });

  it("is false for an empty invoice", () => {
    expect(isWarrantyInvoice({ price: 0, lines: [] })).toBe(false);
    expect(isWarrantyInvoice({ price: 0 })).toBe(false);
  });

  it("ignores $0 / $0 lines of any code", () => {
    expect(
      isWarrantyInvoice({ price: 0, lines: [{ code: W, cost: 10, price: 0 }, { code: "", cost: 0, price: 0 }] }),
    ).toBe(true);
  });
});

describe("warrantyPart", () => {
  it("sums only the 88 90 00 lines", () => {
    expect(
      warrantyPart({
        lines: [
          { code: W, cost: 978, price: 0 },
          { code: " 88 90 00 ", cost: 760.1, price: 0 },
          { code: "01 31 10", cost: 90, price: 106.2 },
        ],
      }),
    ).toEqual({ cost: 1738.1, price: 0 });
  });
});
