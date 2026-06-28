const assert = require("node:assert/strict");
const test = require("node:test");

process.env.STORAGE_MODE = "json";
const app = require("../server");

test("certificate renderer builds an image-ready SVG from the official template", async () => {
  const svg = await app.buildCertificateSvg({
    certificateId: "CERT-TEST-1",
    catalogueNumber: "OM553-02-02-045",
    productName: "Syringe filter",
    lotNumber: "S5527F",
    certificateData: {
      company: "Omsons Germany",
      membrane: "Nylon & PES",
      poreSize: "0.22 µm",
      housing: "PP",
      filterDiameter: "25 mm",
      burstPressure: "5 bar",
      holdupVolume: "< 100 µL",
      sterilityType: "Sterile",
      sterilizationMethod: "EO",
      expiryDate: "2028-06-27"
    }
  });

  assert.match(svg, /^<\?xml/);
  assert.match(svg, /data:image\/png;base64,/);
  assert.match(svg, /Nylon &amp; PES/);
  assert.match(svg, /OM553-02-02-045/);
  assert.match(svg, /S5527F/);
});

test("Cloudinary delivery URLs select WebP and JPEG output", () => {
  const source = "https://res.cloudinary.com/demo/image/upload/v1/folder/certificate.svg";
  assert.equal(
    app.certificateDeliveryUrl(source, "webp"),
    "https://res.cloudinary.com/demo/image/upload/f_webp,q_auto/v1/folder/certificate.webp"
  );
  assert.equal(
    app.certificateDeliveryUrl(source, "jpg"),
    "https://res.cloudinary.com/demo/image/upload/f_jpg,q_auto:good/v1/folder/certificate.jpg"
  );
});

test("legacy COA links redirect directly to the WebP certificate", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/coa/CERT-TEST-1`,
    { redirect: "manual" }
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/api/certificates/CERT-TEST-1/image.webp");
});
