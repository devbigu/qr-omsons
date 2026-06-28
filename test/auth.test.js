const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omsons-auth-"));
process.env.STORAGE_MODE = "json";
process.env.DATA_DIR = dataDir;
process.env.CLOUDINARY_CLOUD_NAME = "";
process.env.CLOUDINARY_API_KEY = "";
process.env.CLOUDINARY_API_SECRET = "";
process.env.ADMIN_USERNAME = "admin@example.com";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("correct-password", 4);
process.env.SESSION_SECRET = "auth-test-session-secret";
process.env.SESSION_TTL_DAYS = "7";

fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify({
  products: [],
  lots: [],
  qr_batches: [],
  qr_labels: [],
  certificates: [{
    _id: "certificate_auth_public",
    certificateId: "CERT-PUBLIC-1",
    certificateImageCloudinaryUrl: "https://res.cloudinary.com/demo/image/upload/v1/certificates/public.svg",
    certificateImagePublicId: "certificates/public"
  }]
}));

const app = require("../server");

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";")[0];
}

test("shared login protects admin routes while certificate scan routes stay public", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/login?next=%2F");

  const deepLink = await fetch(`${baseUrl}/?id=qr-S5527F`, { redirect: "manual" });
  assert.equal(deepLink.status, 302);
  assert.equal(deepLink.headers.get("location"), "/login?next=%2F%3Fid%3Dqr-S5527F");

  const protectedApi = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(protectedApi.status, 401);
  assert.deepEqual(await protectedApi.json(), { error: "Not authenticated" });

  for (const route of [
    "/api/certificates/CERT-PUBLIC-1/qr.png",
    "/api/certificates/CERT-PUBLIC-1/qr.jpg",
    "/api/certificates/CERT-PUBLIC-1/dxf",
    "/api/qr-labels/zip?lotNumber=S5527F"
  ]) {
    const protectedDownload = await fetch(`${baseUrl}${route}`);
    assert.equal(protectedDownload.status, 401);
    assert.deepEqual(await protectedDownload.json(), { error: "Not authenticated" });
  }

  const protectedStatic = await fetch(`${baseUrl}/app.js`, { redirect: "manual" });
  assert.equal(protectedStatic.status, 302);
  assert.equal(protectedStatic.headers.get("location"), "/login?next=%2Fapp.js");

  const loginPage = await fetch(`${baseUrl}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /id="loginForm"/);

  const anonymousStatus = await fetch(`${baseUrl}/api/auth/status`);
  assert.deepEqual(await anonymousStatus.json(), { authenticated: false });

  for (const credentials of [
    { username: "admin@example.com", password: "wrong-password" },
    { username: "wrong@example.com", password: "correct-password" }
  ]) {
    const rejected = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials)
    });
    assert.equal(rejected.status, 401);
    assert.deepEqual(await rejected.json(), { error: "Invalid credentials" });
    assert.equal(rejected.headers.get("set-cookie"), null);
  }

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);

  const publicImage = await fetch(
    `${baseUrl}/api/certificates/CERT-PUBLIC-1/image.webp`,
    { redirect: "manual" }
  );
  assert.equal(publicImage.status, 302);
  assert.equal(
    publicImage.headers.get("location"),
    "https://res.cloudinary.com/demo/image/upload/f_webp,q_auto/v1/certificates/public.webp"
  );

  const coa = await fetch(`${baseUrl}/coa/CERT-PUBLIC-1`, { redirect: "manual" });
  assert.equal(coa.status, 302);
  assert.equal(coa.headers.get("location"), "/api/certificates/CERT-PUBLIC-1/image.webp");

  const catalogue = await fetch(`${baseUrl}/catalogue/CERT-PUBLIC-1`, { redirect: "manual" });
  assert.equal(catalogue.status, 302);
  assert.equal(catalogue.headers.get("location"), "/coa/CERT-PUBLIC-1");

  const accepted = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ADMIN@EXAMPLE.COM", password: "correct-password" })
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true });
  const setCookie = accepted.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = cookieFrom(accepted);

  const authenticatedStatus = await fetch(`${baseUrl}/api/auth/status`, {
    headers: { cookie }
  });
  assert.deepEqual(await authenticatedStatus.json(), { authenticated: true });

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { cookie } });
  assert.equal(dashboard.status, 200);

  const resumedDeepLink = await fetch(`${baseUrl}/?id=qr-S5527F`, { headers: { cookie } });
  assert.equal(resumedDeepLink.status, 200);

  const externalNext = await fetch(`${baseUrl}/login?next=https://evil.example`, {
    redirect: "manual",
    headers: { cookie }
  });
  assert.equal(externalNext.status, 302);
  assert.equal(externalNext.headers.get("location"), "/");

  const logout = await fetch(`${baseUrl}/api/logout`, {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });

  const afterLogout = await fetch(`${baseUrl}/api/dashboard`, { headers: { cookie } });
  assert.equal(afterLogout.status, 401);
});
