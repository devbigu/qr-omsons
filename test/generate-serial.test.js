const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omsons-generate-serial-"));
Object.assign(process.env, {
  STORAGE_MODE: "json",
  DATA_DIR: dataDir,
  MONGODB_URI: "",
  CLOUDINARY_CLOUD_NAME: "demo",
  CLOUDINARY_API_KEY: "key",
  CLOUDINARY_API_SECRET: "secret",
  ADMIN_USERNAME: "admin@example.com",
  ADMIN_PASSWORD_HASH: bcrypt.hashSync("test-password", 4),
  SESSION_SECRET: "generate-serial-test-session-secret"
});

fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify({
  products: [{
    _id: "product_1",
    catalogueNumber: "OM553-02",
    productName: "PES Syringe Filters",
    membrane: "PES",
    poreSize: "0.45µm",
    sterilityType: "Sterile"
  }],
  lots: [],
  qr_batches: [],
  qr_labels: [],
  certificates: []
}));

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://api.cloudinary.com/")) return realFetch(url, options);
  const publicId = options.body.get("public_id");
  return new Response(JSON.stringify({ secure_url: `https://res.cloudinary.com/demo/${publicId}.svg`, public_id: publicId }));
};

const app = require("../server");

test("generating without serials makes one label per click with internal serials", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await realFetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin@example.com", password: "test-password" })
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const generate = () => realFetch(`${baseUrl}/api/qr-batches/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ catalogueNumber: "OM553-02", manufacturingDate: "2026-03-05" })
  }).then(async (response) => ({ status: response.status, body: await response.json() }));

  const first = await generate();
  const second = await generate();
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(first.body.labels.length, 1);
  assert.equal(first.body.labels[0].lotNumber, "SPS0456S01");
  assert.equal(second.body.labels[0].lotNumber, "SPS0456S01", "same product + day stays in one lot");
  assert.deepEqual([first.body.labels[0].serialNumber, second.body.labels[0].serialNumber], [1, 2]);
});
