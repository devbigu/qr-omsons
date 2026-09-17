const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omsons-roles-"));
process.env.STORAGE_MODE = "json";
process.env.DATA_DIR = dataDir;
process.env.ADMIN_USERNAME = "admin@example.com";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("admin-password", 4);
process.env.JWT_SECRET = "roles-test-secret";

fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify({
  products: [{ _id: "product_1", catalogueNumber: "OM260-020", productName: "Nylon" }],
  lots: [],
  qr_batches: [],
  qr_labels: [],
  certificates: []
}));

const app = require("../server");

test("admin manages users; users are limited to the rights they were given", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const call = (route, { cookie, method = "GET", body } = {}) => fetch(`${baseUrl}${route}`, {
    method,
    headers: { "content-type": "application/json", connection: "close", ...(cookie ? { cookie } : {}) },
    body: body && JSON.stringify(body)
  });
  const login = async (username, password) => {
    const response = await call("/api/login", { method: "POST", body: { username, password } });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };

  const admin = await login("admin@example.com", "admin-password");
  assert.deepEqual((await (await call("/api/me", { cookie: admin })).json()).role, "admin");

  const created = await call("/api/users", {
    cookie: admin,
    method: "POST",
    body: { username: "clerk", password: "clerk-password", permissions: ["product:edit", "bogus"] }
  });
  assert.equal(created.status, 201);
  const user = await created.json();
  assert.deepEqual(user.permissions, ["product:edit"]);
  assert.equal(user.passwordHash, undefined);

  const duplicate = await call("/api/users", {
    cookie: admin,
    method: "POST",
    body: { username: "CLERK", password: "another-password" }
  });
  assert.equal(duplicate.status, 400);

  const clerk = await login("clerk", "clerk-password");
  const me = await (await call("/api/me", { cookie: clerk })).json();
  assert.deepEqual(me, { username: "clerk", role: "user", permissions: ["product:edit"] });

  assert.equal((await call("/api/products", { cookie: clerk })).status, 200);
  assert.equal((await call("/api/users", { cookie: clerk })).status, 403);
  assert.equal((await call("/api/users", { cookie: clerk, method: "POST", body: {} })).status, 403);
  assert.equal((await call("/api/products/product_1", { cookie: clerk, method: "DELETE" })).status, 403);
  assert.equal((await call("/api/qr-batches/generate", { cookie: clerk, method: "POST", body: {} })).status, 403);

  // Rights are read on every request, so an edit applies to the existing login.
  const updated = await call(`/api/users/${user._id}`, {
    cookie: admin,
    method: "PUT",
    body: { permissions: ["product:delete"] }
  });
  assert.equal(updated.status, 200);
  assert.equal((await call("/api/products/product_1", { cookie: clerk, method: "DELETE" })).status, 204);

  // Deactivated users are signed out and cannot sign in.
  await call(`/api/users/${user._id}`, { cookie: admin, method: "PUT", body: { active: false } });
  assert.equal((await call("/api/me", { cookie: clerk })).status, 401);
  const blocked = await call("/api/login", { method: "POST", body: { username: "clerk", password: "clerk-password" } });
  assert.equal(blocked.status, 401);

  assert.equal((await call(`/api/users/${user._id}`, { cookie: admin, method: "DELETE" })).status, 204);
  assert.deepEqual(await (await call("/api/users", { cookie: admin })).json(), []);
});
