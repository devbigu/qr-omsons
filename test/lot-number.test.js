const assert = require("node:assert/strict");
const os = require("node:os");
const test = require("node:test");

process.env.STORAGE_MODE = "json";
process.env.DATA_DIR = os.tmpdir();
process.env.SESSION_SECRET = "lot-number-test-session-secret";

const { suggestLot } = require("../server");

test("lot number = membrane code + pore code + year + serial", () => {
  const nylon = { catalogueNumber: "A", membrane: "Nylon", poreSize: "0.2µm" };
  assert.equal(suggestLot(nylon, "2026-03-05").lotNumber, "SNY002601");

  const glass = { catalogueNumber: "B", membrane: "PES with Micro-glass Fiber", poreSize: "10µm" };
  assert.equal(suggestLot(glass, "2026-03-05").lotNumber, "SPS100601");
  assert.equal(suggestLot({ ...glass, poreSize: "0.45µm" }, "2027-01-01").lotNumber, "SPS045701");

  const lots = [
    { catalogueNumber: "A", lotNumber: "SNY002601", manufacturingDate: "2026-03-05" },
    { catalogueNumber: "C", lotNumber: "SNY002602", manufacturingDate: "2026-03-06" },
    { catalogueNumber: "A", lotNumber: "SNY045609", manufacturingDate: "2026-03-06" }
  ];
  assert.equal(suggestLot(nylon, "2026-03-07", lots).lotNumber, "SNY002603");
  assert.equal(suggestLot(nylon, "2026-03-05", lots).lotNumber, "SNY002601", "same product + day reuses lot");

  // unknown membrane keeps the legacy rule
  assert.equal(suggestLot({ membrane: "Other", poreSize: "0.2µm" }, "2026-03-05").lotNumber, "S5505C");
});
