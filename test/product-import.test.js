const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omsons-import-"));
process.env.STORAGE_MODE = "json";
process.env.DATA_DIR = dataDir;
process.env.ADMIN_USERNAME = "admin@example.com";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("admin-password", 4);
process.env.JWT_SECRET = "import-test-secret";

fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify({
  products: [{ _id: "product_1", catalogueNumber: "OM260-020", productName: "Nylon" }],
  lots: [],
  qr_batches: [],
  qr_labels: [],
  certificates: []
}));

const app = require("../server");

test("bulk import adds new products, keeps the original catalogue number, and skips duplicates", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ username: "admin@example.com", password: "admin-password" })
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = (route, body, headers = { cookie }) => fetch(`${baseUrl}${route}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", connection: "close", ...headers },
    body: body && JSON.stringify(body)
  });

  const anonymous = await call("/api/products/bulk", { products: [] }, {});
  assert.equal(anonymous.status, 401);

  const response = await call("/api/products/bulk", {
    products: [
      { productName: "High Flow Syringe Filters", catalogueNumber: "om268-020-gs", originalCatalogueNumber: "OM268-020", filterDiameter: "25" },
      { productName: "Nylon", catalogueNumber: "OM260-020" },
      { productName: "Duplicate in file", catalogueNumber: "OM268-020-GS" },
      { catalogueNumber: "OM999" }
    ]
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.added, ["OM268-020-GS"]);
  assert.deepEqual(result.skipped.map((row) => row.error), [
    "Catalogue number already exists.",
    "Catalogue number already exists.",
    "Product name is required."
  ]);

  const saved = await (await call("/api/products/search?catalogueNumber=OM268-020-GS")).json();
  assert.equal(saved.originalCatalogueNumber, "OM268-020");
  assert.equal(saved.filterDiameter, "25");
  assert.equal(saved.isActive, true);
});
