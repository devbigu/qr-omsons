const assert = require("node:assert/strict");
const os = require("node:os");
const test = require("node:test");

process.env.STORAGE_MODE = "json";
process.env.DATA_DIR = os.tmpdir();
process.env.SESSION_SECRET = "lot-number-test-session-secret";

const { suggestLot } = require("../server");

test("lot number = membrane + pore + year digit + S/N + serial", () => {
  const pesSterile = { catalogueNumber: "A", membrane: "PES", poreSize: "0.45µm", sterilityType: "Sterile" };
  const pesNonSterile = { catalogueNumber: "B", membrane: "PES", poreSize: "0.45µm", sterilityType: "Non-sterile" };
  const nylon = { catalogueNumber: "C", membrane: "Nylon with Micro-glass Fiber", poreSize: "0.45µm", sterilityType: "Non-sterile" };
  assert.equal(suggestLot(pesSterile, "2026-03-05").lotNumber, "SPS0456S01");
  assert.equal(suggestLot({ ...nylon, poreSize: "0.2µm" }, "2027-01-01").lotNumber, "SNY0027N01");

  const lots = [
    { catalogueNumber: "A", lotNumber: "SPS0456S01", manufacturingDate: "2026-03-01" },
    { catalogueNumber: "A", lotNumber: "SPS0456S02", manufacturingDate: "2026-03-02" },
    { catalogueNumber: "B", lotNumber: "SPS0456N01", manufacturingDate: "2026-03-01" }
  ];
  assert.equal(suggestLot(pesSterile, "2026-03-07", lots).lotNumber, "SPS0456S03");
  assert.equal(suggestLot(pesNonSterile, "2026-03-07", lots).lotNumber, "SPS0456N02");
  assert.equal(suggestLot(nylon, "2026-03-07", lots).lotNumber, "SNY0456N01", "each membrane has its own series");
  assert.equal(suggestLot(pesSterile, "2026-03-02", lots).lotNumber, "SPS0456S02", "same product + day reuses lot");

  // unknown membrane keeps the legacy rule
  assert.equal(suggestLot({ membrane: "Other", poreSize: "0.2µm" }, "2026-03-05").lotNumber, "S5505C");
});
