const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const loginSource = fs.readFileSync(path.join(root, "public", "login.html"), "utf8");
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

test("frontend exposes shared QR menus, bulk downloads, and lot URL routing", () => {
  assert.match(htmlSource, /id="downloadBatchZip"/);
  assert.match(htmlSource, /id="downloadLotZip"/);
  assert.match(htmlSource, /id="qrDownloadMenu"/);
  assert.match(appSource, /\/qr\.png/);
  assert.match(appSource, /\/qr\.jpg/);
  assert.match(appSource, /\/dxf/);
  assert.match(appSource, /\/api\/qr-labels\/zip\?batchId=/);
  assert.match(appSource, /lotNumberFromLocation/);
  assert.match(appSource, /\^qr-/);
  assert.match(appSource, /openLotViewer\(initialLot, "replace"\)/);
  assert.match(appSource, /history\[method\]/);
  assert.doesNotMatch(appSource, /downloadFirstLabel|downloadFirstPng/);
  assert.match(cssSource, /\.download-popover/);
  assert.match(cssSource, /\.download-menu-trigger/);
  assert.match(htmlSource, /id="logoutButton"/);
  assert.match(appSource, /response\.status === 401/);
  assert.match(appSource, /\/api\/logout/);
  assert.match(loginSource, /\/api\/login/);
  assert.match(loginSource, /safeNextPath/);
  assert.doesNotMatch(loginSource, /<link[^>]+stylesheet/i);
  assert.deepEqual(vercelConfig.routes, [{ src: "/(.*)", dest: "/server.js" }]);
});