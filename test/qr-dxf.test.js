const assert = require("node:assert/strict");
const test = require("node:test");

process.env.STORAGE_MODE = "json";
const app = require("../server");

test("QR export is a valid ASCII DXF drawing", () => {
  const dxf = app.buildQrDxf({
    certificateId: "CERT-TEST-1",
    qrUrl: "https://example.com/coa/CERT-TEST-1"
  });

  assert.match(dxf, /\n0\nSECTION\n2\nHEADER\n/);
  assert.match(dxf, /\n1\nAC1009\n/);
  assert.match(dxf, /\n0\nSOLID\n8\nQR_DARK\n/);
  assert.match(dxf, /\n0\nEOF\n$/);
  assert.doesNotMatch(dxf, /qr-dxl|<svg/i);
});
