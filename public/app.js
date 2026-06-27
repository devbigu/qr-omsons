const state = {
  products: [],
  currentProduct: null,
  generatedLabels: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

function text(value, fallback = "") {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  alert(message);
}

function showScreen(id) {
  $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.screen === id));
}

function fillLabel(target, label) {
  const node = $("#labelTemplateNode").content.firstElementChild.cloneNode(true);
  const membranePore = `${text(label.membrane)}: ${text(label.poreSize)}`.replace(/: $/, "");
  node.querySelector('[data-field="productName"]').textContent = text(label.productName, "Puricap PES");
  node.querySelector('[data-field="catalogueNumber"]').textContent = text(label.catalogueNumber, "OM553-02-02-045");
  node.querySelector('[data-field="membranePore"]').textContent = membranePore || "PES: 0.45 + 0.2um";
  node.querySelector('[data-field="lotNumber"]').textContent = text(label.lotNumber, "S5516E");
  node.querySelector('[data-field="membrane"]').textContent = text(label.membrane, "PES");
  node.querySelector('[data-field="serialNumber"]').textContent = text(label.serialNumber, "101");
  node.querySelector('[data-field="qrImagePath"]').src = text(label.qrImagePath, makePlaceholderQr());
  target.replaceChildren(node);
  return node;
}

function makePlaceholderQr() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90"><rect width="90" height="90" fill="white"/><path d="M6 6h24v24H6zM60 6h24v24H60zM6 60h24v24H6z" fill="#111"/><path d="M12 12h12v12H12zM66 12h12v12H66zM12 66h12v12H12z" fill="#fff"/><path d="M39 9h6v6h-6zM51 9h3v12h-3zM39 24h15v6H39zM36 39h9v6h-9zM51 36h6v12h-6zM66 39h12v6H66zM36 54h6v24h-6zM48 54h12v6H48zM66 54h6v18h-6zM78 72h6v12h-6zM48 72h12v12H48z" fill="#111"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function previewFromForm() {
  const product = state.currentProduct || {};
  fillLabel($("#singleLabelPreview"), {
    productName: product.productName || $("#productName").value || "Puricap PES",
    catalogueNumber: $("#genCatalogue").value || product.catalogueNumber || "OM553-02-02-045",
    membrane: product.membrane || "PES",
    poreSize: product.poreSize || "0.45 + 0.2um",
    lotNumber: $("#lotNumber").value || "S5516E",
    serialNumber: $("#startSerial").value || "101",
    qrImagePath: makePlaceholderQr()
  });
}

function renderLabels(labels) {
  const sheet = $("#labelSheet");
  sheet.replaceChildren();
  if (!labels.length) {
    sheet.innerHTML = `<div class="empty-state">No labels in this preview.</div>`;
    return;
  }

  labels.forEach((label) => {
    const card = document.createElement("div");
    card.className = "label-card";
    const holder = document.createElement("div");
    fillLabel(holder, label);
    card.append(holder.firstElementChild);
    card.insertAdjacentHTML("beforeend", `
      <div class="label-actions">
        <span>${html(label.certificateId)}</span>
        <button class="danger" type="button" data-delete-label="${html(label._id)}" data-certificate-id="${html(label.certificateId)}">Delete</button>
      </div>
    `);
    sheet.append(card);
  });
}

function renderProductSummary(product) {
  state.currentProduct = product;
  $("#productSummary").innerHTML = product
    ? `<strong>${html(product.productName)}</strong><br>${html(product.catalogueNumber)}<br>${html(product.company || "Omsons Germany")}<br>${html(product.membrane)}: ${html(product.poreSize)}<br>${html(product.housing || "")}${product.filterDiameter ? ` | ${html(product.filterDiameter)}` : ""}<br>${html(product.sterilityType || "")}`
    : "No product selected.";
}

function productPayload() {
  return {
    productName: $("#productName").value,
    catalogueNumber: $("#catalogueNumber").value,
    productType: $("#productType").value,
    category: $("#category").value,
    membrane: $("#membrane").value,
    poreSize: $("#poreSize").value,
    technicalDetail: $("#technicalDetail").value,
    company: $("#company").value,
    sterilityType: $("#sterilityType").value,
    housing: $("#housing").value,
    filterDiameter: $("#filterDiameter").value,
    burstPressure: $("#burstPressure").value,
    holdupVolume: $("#holdupVolume").value,
    sterilizationMethod: $("#sterilizationMethod").value,
    packSize: $("#packSize").value,
    hsnCode: $("#hsnCode").value,
    labelTemplate: $("#labelTemplate").value,
    certificateTemplate: $("#certificateTemplate").value,
    lotRule: {
      prefix: $("#lotPrefix").value,
      suffix: $("#lotSuffix").value,
      productCode: $("#lotProductCode").value,
      dateFormat: "DDM",
      monthCodes: $("#lotMonthCodes").value.split(",").map((code) => code.trim()).filter(Boolean),
      allowManualOverride: true
    },
    isActive: $("#isActive").checked
  };
}

function fillProductForm(product) {
  $("#productId").value = product._id || "";
  $("#productName").value = product.productName || "";
  $("#catalogueNumber").value = product.catalogueNumber || "";
  $("#productType").value = product.productType || "Syringe filter";
  $("#category").value = product.category || "Membrane filter";
  $("#company").value = product.company || "Omsons Germany";
  $("#membrane").value = product.membrane || "";
  $("#poreSize").value = product.poreSize || "";
  $("#technicalDetail").value = product.technicalDetail || "";
  $("#sterilityType").value = product.sterilityType || "Non-sterile";
  $("#housing").value = product.housing || "Polypropylene";
  $("#filterDiameter").value = product.filterDiameter || "";
  $("#burstPressure").value = product.burstPressure || "> 7kg/cm²";
  $("#holdupVolume").value = product.holdupVolume || "";
  $("#sterilizationMethod").value = product.sterilizationMethod || "";
  $("#packSize").value = product.packSize || "";
  $("#hsnCode").value = product.hsnCode || "";
  $("#labelTemplate").value = product.labelTemplate || "omsons_sample_v1";
  $("#certificateTemplate").value = product.certificateTemplate || "standard_coa_v1";
  $("#lotPrefix").value = product.lotRule?.prefix || "S";
  $("#lotSuffix").value = product.lotRule?.suffix || "";
  $("#lotProductCode").value = product.lotRule?.productCode || "";
  $("#lotMonthCodes").value = (product.lotRule?.monthCodes || ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]).join(",");
  $("#isActive").checked = product.isActive !== false;
}

function renderProducts() {
  const query = $("#productSearch").value.trim().toUpperCase();
  const list = $("#productList");
  const products = state.products.filter((product) =>
    [product.catalogueNumber, product.productName, product.membrane, product.poreSize, product.company].join(" ").toUpperCase().includes(query));
  list.replaceChildren();
  if (!products.length) {
    list.innerHTML = `<div class="empty-state">${state.products.length ? "No matching products." : "No products yet."}</div>`;
    return;
  }
  products.forEach((product) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-item";
    item.innerHTML = `<strong>${html(product.catalogueNumber)}</strong><span>${html(product.productName)} - ${html(product.membrane)} - ${html(product.poreSize)}</span>`;
    item.addEventListener("click", async () => {
      fillProductForm(product);
      $("#genCatalogue").value = product.catalogueNumber;
      renderProductSummary(product);
      await refreshLotNumber().catch((error) => toast(error.message));
      previewFromForm();
    });
    list.append(item);
  });
}

async function loadProducts(preferredCatalogue = "") {
  state.products = await api("/api/products");
  renderProducts();

  const select = $("#genCatalogue");
  const previousValue = preferredCatalogue || select.value;
  select.innerHTML = '<option value="">Select a product</option>';
  state.products
    .filter((product) => product.isActive !== false)
    .forEach((product) => {
      const option = document.createElement("option");
      option.value = product.catalogueNumber;
      option.textContent = `${product.productName} (${product.catalogueNumber})`;
      select.append(option);
    });

  const selected = state.products.find((product) => product.catalogueNumber === previousValue) || state.products[0] || null;
  select.value = selected?.catalogueNumber || "";
  select.disabled = !selected;
  $("#generateForm").querySelector('button[type="submit"]').disabled = !selected;

  if (selected) {
    renderProductSummary(selected);
    fillProductForm(selected);
  } else {
    state.currentProduct = null;
    renderProductSummary(null);
    $("#lotNumber").value = "";
    $("#lotRulePreview").textContent = "";
  }
}

async function loadDashboard() {
  const [dashboard, health] = await Promise.all([api("/api/dashboard"), api("/api/health")]);
  $("#storagePill").textContent = `Storage: ${health.storage}`;
  $("#totalProducts").textContent = dashboard.totalProducts;
  $("#totalLabels").textContent = dashboard.totalLabels;
  $("#totalBatches").textContent = dashboard.totalBatches;
  $("#totalCertificates").textContent = dashboard.totalCertificates;
  $("#recentLabels").innerHTML = dashboard.recentLabels.map((label) => `
    <tr>
      <td>${html(label.certificateId)}</td>
      <td>${html(label.catalogueNumber)}</td>
      <td>${html(label.lotNumber)}</td>
      <td>${html(label.serialNumber)}</td>
      <td class="status-valid">${html(label.status)}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No labels generated yet.</td></tr>`;
}

async function lookupProduct() {
  const catalogue = $("#genCatalogue").value.trim();
  if (!catalogue) return null;
  const product = await api(`/api/products/search?catalogueNumber=${encodeURIComponent(catalogue)}`);
  renderProductSummary(product);
  await refreshLotNumber();
  previewFromForm();
  return product;
}
async function refreshLotNumber() {
  const catalogue = $("#genCatalogue").value.trim();
  if (!catalogue) return;
  const date = $("#manufacturingDate").value;
  const params = new URLSearchParams({ catalogueNumber: catalogue });
  if (date) params.set("manufacturingDate", date);
  const lot = await api(`/api/lots/suggest?${params}`);
  $("#lotNumber").value = lot.lotNumber;
  $("#lotRulePreview").innerHTML = `<strong>${html(lot.lotNumber)}</strong><br>${html(lot.ruleText)}<br>Month ${html(lot.month)} maps to code ${html(lot.monthCode)}`;
  previewFromForm();
}
function updateBatchCount() {
  const start = Number($("#startSerial").value);
  const end = Number($("#endSerial").value);
  const count = Number.isInteger(start) && Number.isInteger(end) && end >= start ? end - start + 1 : 0;
  const valid = count > 0 && count <= 300;
  $("#batchCount").textContent = count > 300
    ? "A batch can contain no more than 300 labels."
    : count
      ? `${count} label${count === 1 ? "" : "s"} will be generated.`
      : "End serial must be equal to or greater than start serial.";
  $("#batchCount").classList.toggle("invalid", !valid);
  $("#generateForm").querySelector('button[type="submit"]').disabled = !state.currentProduct || !valid;
}

async function saveProduct(event) {
  event.preventDefault();
  const id = $("#productId").value;
  const payload = productPayload();
  const saved = await api(id ? `/api/products/${id}` : "/api/products", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload)
  });
  fillProductForm(saved);
  renderProductSummary(saved);
  await loadProducts(saved.catalogueNumber);
  await refreshLotNumber();
  await loadDashboard();
  toast("Product saved.");
}

async function generateLabels(event) {
  event.preventDefault();
  await refreshLotNumber();
  const payload = {
    catalogueNumber: $("#genCatalogue").value,
    lotNumber: $("#lotNumber").value,
    manufacturingDate: $("#manufacturingDate").value,
    expiryDate: $("#expiryDate").value,
    startSerial: Number($("#startSerial").value),
    endSerial: Number($("#endSerial").value)
  };
  const result = await api("/api/qr-batches/generate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.generatedLabels = result.labels;
  renderLabels(result.labels);
  fillLabel($("#singleLabelPreview"), result.labels[0]);
  await loadDashboard();
  await Promise.all([searchCertificates(), loadBatches()]);
  showScreen("labels");
}

async function searchCertificates() {
  const params = new URLSearchParams();
  if ($("#certCatalogue").value) params.set("catalogueNumber", $("#certCatalogue").value);
  if ($("#certLot").value) params.set("lotNumber", $("#certLot").value);
  if ($("#certSerial").value) params.set("serialNumber", $("#certSerial").value);
  const rows = await api(`/api/certificates/search?${params}`);
  $("#certificateRows").innerHTML = rows.map((certificate) => `
    <tr>
      <td>${html(certificate.certificateId)}</td>
      <td>${html(certificate.productName)}</td>
      <td>${html(certificate.lotNumber)}</td>
      <td>${html(certificate.serialNumber)}</td>
      <td><a href="/coa/${encodeURIComponent(certificate.certificateId)}" target="_blank" rel="noopener">Open COA</a></td>
      <td>${certificate.qrDxlUrl ? `<a href="${html(certificate.qrDxlUrl)}" target="_blank" rel="noopener">Open DXL</a>` : "-"}</td>
      <td><button class="danger compact" type="button" data-delete-label="${html(certificate.qrLabelId)}" data-certificate-id="${html(certificate.certificateId)}">Delete</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7">No certificate records found.</td></tr>`;
}

async function loadBatches() {
  const batches = await api("/api/qr-batches");
  batches.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  $("#batchRows").innerHTML = batches.map((batch) => `
    <tr>
      <td><strong>${html(batch.productName || batch.catalogueNumber)}</strong><br>${html(batch.catalogueNumber)}</td>
      <td>${html(batch.lotNumber || "-")}</td>
      <td>${html(batch.startSerial)}-${html(batch.endSerial)}</td>
      <td>${html(batch.quantity)}</td>
      <td>${html(batch.createdAt ? new Date(batch.createdAt).toLocaleString() : "-")}</td>
      <td><button class="secondary compact" type="button" data-reprint-batch="${html(batch.batchId)}">Reprint</button></td>
    </tr>
  `).join("") || `<tr><td colspan="6">No saved batches yet.</td></tr>`;
}

async function reprintBatch(batchId) {
  const labels = await api(`/api/qr-labels?batchId=${encodeURIComponent(batchId)}`);
  if (!labels.length) return toast("No labels remain in this batch.");
  state.generatedLabels = labels;
  renderLabels(labels);
  fillLabel($("#singleLabelPreview"), labels[0]);
  showScreen("labels");
}

async function deleteLabel(labelId, certificateId) {
  if (!labelId) return toast("This record cannot be deleted because its label ID is missing.");
  const ok = confirm(`Delete ${certificateId}? This removes the label and COA record, so the serial can be generated again.`);
  if (!ok) return;

  await api(`/api/qr-labels/${encodeURIComponent(labelId)}`, { method: "DELETE" });
  state.generatedLabels = state.generatedLabels.filter((label) => String(label._id) !== String(labelId));
  renderLabels(state.generatedLabels);
  if (state.generatedLabels[0]) fillLabel($("#singleLabelPreview"), state.generatedLabels[0]);
  else previewFromForm();
  await loadDashboard();
  await searchCertificates();
  toast("Label deleted.");
}

async function downloadFirstLabel() {
  const label = state.generatedLabels[0];
  if (!label) return toast("Generate at least one label first.");

  const canvas = document.createElement("canvas");
  const scale = 3;
  canvas.width = 384 * scale;
  canvas.height = 180 * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 384, 180);
  ctx.strokeStyle = "#cfd5dc";
  ctx.strokeRect(0.5, 0.5, 383, 179);
  ctx.fillStyle = "#0789c9";
  ctx.beginPath();
  ctx.ellipse(53, 28, 35, 12.5, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "900 13px Arial";
  ctx.fillText("OMSONS", 24, 32);
  ctx.fillStyle = "#1d72ad";
  ctx.font = "800 10px Arial";
  ctx.fillText("G E R M A N Y", 20, 54);
  ctx.fillStyle = "#151515";
  ctx.font = "900 16px Arial";
  ctx.fillText(label.productName, 76, 66);
  ctx.fillText(`Cat. No.: ${label.catalogueNumber}`, 76, 86);
  ctx.fillText(`${label.membrane}: ${label.poreSize}`, 76, 106);
  ctx.fillText(`Lot. No.: ${label.lotNumber}`, 76, 138);
  ctx.fillText(`Membranes : ${label.membrane}`, 76, 158);
  ctx.fillText(`Serial No.: ${label.serialNumber}`, 76, 178);
  const qr = new Image();
  qr.onload = () => {
    ctx.drawImage(qr, 234, 102, 52, 52);
    ctx.font = "800 9px Arial";
    ctx.fillText("Scan for COA", 221, 166);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${label.certificateId}.png`;
    link.click();
  };
  qr.src = label.qrImagePath;
}

function bindEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.screen)));
  $("#productSearch").addEventListener("input", renderProducts);
  $("#productForm").addEventListener("submit", saveProduct);
  $("#manufacturingDate").addEventListener("change", () => refreshLotNumber().catch((error) => toast(error.message)));
  $("#genCatalogue").addEventListener("change", () => lookupProduct().catch((error) => toast(error.message)));
  $("#startSerial").addEventListener("input", () => {
    const start = Number($("#startSerial").value);
    if (start > Number($("#endSerial").value)) $("#endSerial").value = String(start);
    updateBatchCount();
  });
  $("#endSerial").addEventListener("input", updateBatchCount);
  $("#previewFromForm").addEventListener("click", previewFromForm);
  $("#generateForm").addEventListener("submit", (event) => generateLabels(event).catch((error) => toast(error.message)));
  $("#searchCertificates").addEventListener("click", () => searchCertificates().catch((error) => toast(error.message)));
  $("#printLabels").addEventListener("click", () => window.print());
  $("#downloadFirstPng").addEventListener("click", downloadFirstLabel);
  document.addEventListener("click", (event) => {
    const reprintButton = event.target.closest("[data-reprint-batch]");
    if (reprintButton) {
      reprintBatch(reprintButton.dataset.reprintBatch).catch((error) => toast(error.message));
      return;
    }
    const button = event.target.closest("[data-delete-label]");
    if (!button) return;
    deleteLabel(button.dataset.deleteLabel, button.dataset.certificateId).catch((error) => toast(error.message));
  });
}
async function boot() {
  bindEvents();
  const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#manufacturingDate").value = localToday;
  await loadProducts();
  await loadDashboard();
  await refreshLotNumber().catch(() => {});
  updateBatchCount();
  previewFromForm();
  await Promise.all([searchCertificates(), loadBatches()]);
}
boot().catch((error) => toast(error.message));


