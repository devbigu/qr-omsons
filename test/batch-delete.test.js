const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omsons-batch-delete-"));
process.env.STORAGE_MODE = "json";
process.env.DATA_DIR = dataDir;
process.env.CLOUDINARY_CLOUD_NAME = "";
process.env.CLOUDINARY_API_KEY = "";
process.env.CLOUDINARY_API_SECRET = "";
process.env.ADMIN_USERNAME = "admin@example.com";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("test-password", 4);
process.env.SESSION_SECRET = "batch-delete-test-session-secret";

fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify({
  products: [],
  lots: [],
  qr_batches: [
    { _id: "batch_record_1", batchId: "BATCH-1", quantity: 1 },
    { _id: "batch_record_2", batchId: "BATCH-2", quantity: 1 }
  ],
  qr_labels: [
    { _id: "label_1", batchId: "BATCH-1", certificateId: "CERT-1" },
    { _id: "label_2", batchId: "BATCH-2", certificateId: "CERT-2" }
  ],
  certificates: [
    { _id: "certificate_1", certificateId: "CERT-1", qrLabelId: "label_1" },
    { _id: "certificate_2", certificateId: "CERT-2", qrLabelId: "label_2" }
  ]
}));

const app = require("../server");

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ username: "ADMIN@example.com", password: "test-password" })
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";")[0];
}

test("deleting a batch cascades only to its labels and certificates", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login(baseUrl);
  const deletedResponse = await fetch(`${baseUrl}/api/qr-batches/BATCH-1`, {
    method: "DELETE",
    headers: { connection: "close", cookie }
  });
  const deleted = await deletedResponse.json();

  assert.equal(deletedResponse.status, 200);
  assert.equal(deleted.deletedLabels, 1);
  assert.equal(deleted.deletedCertificates, 1);

  const batches = await (await fetch(`${baseUrl}/api/qr-batches`, {
    headers: { connection: "close", cookie }
  })).json();
  const labels = await (await fetch(`${baseUrl}/api/qr-labels`, {
    headers: { connection: "close", cookie }
  })).json();
  const certificates = await (await fetch(`${baseUrl}/api/certificates/search`, {
    headers: { connection: "close", cookie }
  })).json();

  assert.deepEqual(batches.map((batch) => batch.batchId), ["BATCH-2"]);
  assert.deepEqual(labels.map((label) => label.batchId), ["BATCH-2"]);
  assert.deepEqual(certificates.map((certificate) => certificate.certificateId), ["CERT-2"]);
});
