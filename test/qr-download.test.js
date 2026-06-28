const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omsons-qr-download-"));
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pngDataUrl = `data:image/png;base64,${pngBase64}`;
const pngFile = path.join(dataDir, "local-qr.png");
fs.writeFileSync(pngFile, Buffer.from(pngBase64, "base64"));

process.env.STORAGE_MODE = "json";
process.env.DATA_DIR = dataDir;
process.env.CLOUDINARY_CLOUD_NAME = "demo";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify({
  products: [],
  lots: [],
  qr_batches: [],
  qr_labels: [
    {
      _id: "label_1",
      batchId: "BATCH-1",
      certificateId: "CERT-LOCAL-1",
      catalogueNumber: "OM260-020",
      lotNumber: "S5527F",
      serialNumber: 1,
      qrImagePath: pngDataUrl
    },
    {
      _id: "label_2",
      batchId: "BATCH-1",
      certificateId: "CERT-LOCAL-2",
      catalogueNumber: "OM260-020",
      lotNumber: "S5527F",
      serialNumber: 2,
      qrImagePath: pngDataUrl
    },
    {
      _id: "label_file",
      batchId: "BATCH-2",
      certificateId: "CERT-FILE-3",
      catalogueNumber: "OM260-020",
      lotNumber: "S5527F",
      serialNumber: 3,
      qrImagePath: pngFile
    },
    {
      _id: "label_cloud",
      batchId: "BATCH-CLOUD",
      certificateId: "CERT-CLOUD-4",
      catalogueNumber: "OM260-020",
      lotNumber: "S5529H",
      serialNumber: 4,
      qrImageCloudinaryUrl: "https://res.cloudinary.com/demo/image/upload/v1/qr.png"
    }
  ],
  certificates: [
    {
      _id: "certificate_1",
      certificateId: "CERT-LOCAL-1",
      catalogueNumber: "OM260-020",
      lotNumber: "S5527F",
      serialNumber: 1,
      verificationUrl: "https://example.com/coa/CERT-LOCAL-1"
    }
  ]
}));

const app = require("../server");

function zipEntryCount(buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let count = 0;
  for (let index = 0; index <= buffer.length - signature.length; index += 1) {
    if (buffer.subarray(index, index + signature.length).equals(signature)) count += 1;
  }
  return count;
}

test("QR routes provide PNG, JPG, Cloudinary redirects, and streaming ZIP exports", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tempBefore = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("omsons-qr-zip"));

  const pngResponse = await fetch(`${baseUrl}/api/certificates/CERT-LOCAL-1/qr.png`);
  const png = Buffer.from(await pngResponse.arrayBuffer());
  assert.equal(pngResponse.status, 200);
  assert.match(pngResponse.headers.get("content-type"), /^image\/png/);
  assert.equal(
    pngResponse.headers.get("content-disposition"),
    'attachment; filename="OM260-020_S5527F_1.png"'
  );
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const jpgResponse = await fetch(`${baseUrl}/api/certificates/CERT-LOCAL-1/qr.jpg`);
  const jpg = Buffer.from(await jpgResponse.arrayBuffer());
  assert.equal(jpgResponse.status, 200);
  assert.match(jpgResponse.headers.get("content-type"), /^image\/jpeg/);
  assert.equal(jpg[0], 0xff);
  assert.equal(jpg[1], 0xd8);

  const fileJpgResponse = await fetch(`${baseUrl}/api/certificates/CERT-FILE-3/qr.jpg`);
  assert.equal(fileJpgResponse.status, 200);
  assert.match(fileJpgResponse.headers.get("content-type"), /^image\/jpeg/);

  const cloudResponse = await fetch(
    `${baseUrl}/api/certificates/CERT-CLOUD-4/qr.jpg`,
    { redirect: "manual" }
  );
  assert.equal(cloudResponse.status, 302);
  assert.equal(
    cloudResponse.headers.get("content-disposition"),
    'attachment; filename="OM260-020_S5529H_4.jpg"'
  );
  assert.equal(
    cloudResponse.headers.get("location"),
    "https://res.cloudinary.com/demo/image/upload/f_jpg,q_auto:good/v1/qr.jpg"
  );

  const batchZipResponse = await fetch(`${baseUrl}/api/qr-labels/zip?batchId=BATCH-1`);
  const batchZip = Buffer.from(await batchZipResponse.arrayBuffer());
  assert.equal(batchZipResponse.status, 200);
  assert.match(batchZipResponse.headers.get("content-type"), /^application\/zip/);
  assert.equal(
    batchZipResponse.headers.get("content-disposition"),
    'attachment; filename="OM260-020_S5527F_1-2.zip"'
  );
  assert.equal(zipEntryCount(batchZip), 2);
  assert.equal(batchZip.includes(Buffer.from("OM260-020_S5527F_1.png")), true);
  assert.equal(batchZip.includes(Buffer.from("OM260-020_S5527F_2.png")), true);

  const lotZipResponse = await fetch(`${baseUrl}/api/qr-labels/zip?lotNumber=S5527F&format=jpg`);
  const lotZip = Buffer.from(await lotZipResponse.arrayBuffer());
  assert.equal(lotZipResponse.status, 200);
  assert.equal(
    lotZipResponse.headers.get("content-disposition"),
    'attachment; filename="OM260-020_S5527F_all.zip"'
  );
  assert.equal(zipEntryCount(lotZip), 3);
  assert.equal(lotZip.includes(Buffer.from("OM260-020_S5527F_1.jpg")), true);
  assert.equal(lotZip.includes(Buffer.from("OM260-020_S5527F_2.jpg")), true);
  assert.equal(lotZip.includes(Buffer.from("OM260-020_S5527F_3.jpg")), true);

  const dxfResponse = await fetch(`${baseUrl}/api/certificates/CERT-LOCAL-1/dxf`);
  assert.equal(dxfResponse.status, 200);
  assert.equal(
    dxfResponse.headers.get("content-disposition"),
    'attachment; filename="OM260-020_S5527F_1.dxf"'
  );

  const missingFilterResponse = await fetch(`${baseUrl}/api/qr-labels/zip`);
  assert.equal(missingFilterResponse.status, 400);

  const tempAfter = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("omsons-qr-zip"));
  assert.deepEqual(tempAfter, tempBefore);
});