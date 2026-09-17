const state = {
  me: null,
  products: [],
  currentProduct: null,
  generatedLabels: [],
  currentBatchId: ""
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    return new Promise(() => {});
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Request failed (${response.status} ${response.statusText}). Restart the server if it was just updated.`);
  }
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

// Mirrors the server's rights; the server still enforces them on every write.
const permissionLabels = {
  "product:add": "Add products",
  "product:edit": "Edit products",
  "product:delete": "Delete products",
  "label:add": "Generate labels & certificates",
  "label:delete": "Delete labels & certificates"
};

function can(...permissions) {
  if (state.me?.role === "admin") return true;
  return permissions.some((permission) => state.me?.permissions?.includes(permission));
}

function applyPermissions() {
  $$("[data-perm]").forEach((element) => {
    element.hidden = !can(...element.dataset.perm.split(" "));
  });
  $("#accountBadge").textContent = state.me ? `${state.me.username} (${state.me.role})` : "";
}

function showScreen(id) {
  const current = $(".screen.active");
  if (current && current.id === id) return;

  $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.screen === id));

  // The entry animation is declarative, so re-trigger it by reflowing the newly shown screen.
  const next = document.getElementById(id);
  if (next) {
    next.style.animation = "none";
    void next.offsetWidth;
    next.style.animation = "";
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
let activeDownloadButton = null;

function downloadMenuButton(record) {
  const certificateId = record?.certificateId || "";
  if (!certificateId) return "-";
  return `
    <button
      class="download-menu-trigger"
      type="button"
      data-download-menu="${html(certificateId)}"
      aria-label="Download QR files for ${html(certificateId)}"
      aria-haspopup="menu"
      aria-expanded="false"
    >&#8942;</button>
  `;
}

function closeDownloadMenu() {
  const menu = $("#qrDownloadMenu");
  if (!menu) return;
  menu.hidden = true;
  menu.replaceChildren();
  if (activeDownloadButton) activeDownloadButton.setAttribute("aria-expanded", "false");
  activeDownloadButton = null;
}

function openDownloadMenu(button) {
  const certificateId = button.dataset.downloadMenu;
  if (!certificateId) return;
  if (activeDownloadButton === button && !$("#qrDownloadMenu").hidden) {
    closeDownloadMenu();
    return;
  }

  closeDownloadMenu();
  const encodedId = encodeURIComponent(certificateId);
  const menu = $("#qrDownloadMenu");
  menu.innerHTML = `
    <a role="menuitem" data-download-link href="/api/certificates/${encodedId}/qr.png">Download PNG</a>
    <a role="menuitem" data-download-link href="/api/certificates/${encodedId}/qr.jpg">Download JPG</a>
    <a role="menuitem" data-download-link href="/api/certificates/${encodedId}/dxf">Download DXF</a>
  `;
  menu.hidden = false;
  activeDownloadButton = button;
  button.setAttribute("aria-expanded", "true");

  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(buttonRect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
  const below = buttonRect.bottom + 6;
  const top = below + menuRect.height <= window.innerHeight - 8
    ? below
    : Math.max(8, buttonRect.top - menuRect.height - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function startDownload(url) {
  const link = document.createElement("a");
  link.href = url;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

function lotNumberFromLocation() {
  const id = new URLSearchParams(window.location.search).get("id") || "";
  if (!/^qr-/i.test(id)) return "";
  return id.slice(3).trim().toUpperCase();
}

function setLotViewerUrl(lotNumber, mode = "push") {
  const lot = String(lotNumber || "").trim().toUpperCase();
  if (!lot) return;
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.searchParams.set("id", `qr-${lot}`);
  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method]({ lotNumber: lot }, "", `${url.pathname}${url.search}${url.hash}`);
}

function clearLotViewerUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("id")) return;
  url.searchParams.delete("id");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function openLotViewer(lotNumber, historyMode = "push") {
  const lot = String(lotNumber || "").trim().toUpperCase();
  if (!lot) return;
  $("#certCatalogue").value = "";
  $("#certLot").value = lot;
  showScreen("certificates");
  if (historyMode) setLotViewerUrl(lot, historyMode);
  await searchCertificates();
}

function updateBatchZipButton(labels) {
  const batchIds = [...new Set(labels.map((label) => label.batchId).filter(Boolean))];
  state.currentBatchId = batchIds.length === 1 ? batchIds[0] : "";
  const button = $("#downloadBatchZip");
  button.hidden = !state.currentBatchId;
  button.dataset.batchId = state.currentBatchId;
}

function fillLabel(target, label) {
  const node = $("#labelTemplateNode").content.firstElementChild.cloneNode(true);
  const membranePore = `${text(label.membrane)}: ${text(label.poreSize)}`.replace(/: $/, "");
  node.querySelector('[data-field="productName"]').textContent = text(label.productName, "Puricap PES");
  node.querySelector('[data-field="catalogueNumber"]').textContent = text(label.catalogueNumber, "OM553-02-02-045");
  node.querySelector('[data-field="membranePore"]').textContent = membranePore || "PES: 0.45 + 0.2um";
  node.querySelector('[data-field="lotNumber"]').textContent = text(label.lotNumber, "S5516E");
  node.querySelector('[data-field="membrane"]').textContent = text(label.membrane, "PES");
  node.querySelector('[data-field="qrImagePath"]').src = text(label.qrImagePath, makePlaceholderQr());
  target.replaceChildren(node);
  return node;
}

function makePlaceholderQr() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90"><rect width="90" height="90" fill="white"/><path d="M6 6h24v24H6zM60 6h24v24H60zM6 60h24v24H6z" fill="#111"/><path d="M12 12h12v12H12zM66 12h12v12H66zM12 66h12v12H12z" fill="#fff"/><path d="M39 9h6v6h-6zM51 9h3v12h-3zM39 24h15v6H39zM36 39h9v6h-9zM51 36h6v12h-6zM66 39h12v6H66zM36 54h6v24h-6zM48 54h12v6H48zM66 54h6v18h-6zM78 72h6v12h-6zM48 72h12v12H48z" fill="#111"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Shelf life by sterilization method: ETO 3 years, Gamma 2 years ("ETO / Gamma" takes the shorter).
function expiryFor(product, manufacturingDate) {
  const method = String(product?.sterilizationMethod || "").toLowerCase();
  const years = method.includes("gamma") ? 2 : method.includes("eto") ? 3 : 0;
  if (!years || !manufacturingDate) return "";
  const date = new Date(`${manufacturingDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

// Same rule as the server's isSterileCertificate: blank or "non-sterile" means non-sterile.
function isSterile(product) {
  const value = String(product?.sterilityType || "").trim();
  return Boolean(value) && !/^non[\s-]?sterile$/i.test(value);
}

function applyExpiry() {
  const mfg = $("#manufacturingDate").value;
  const input = $("#expiryDate");
  // Non-sterile products carry only a manufacturing date.
  const sterile = isSterile(state.currentProduct);
  input.closest("label").hidden = !sterile;
  const max = sterile ? expiryFor(state.currentProduct, mfg) : "";
  input.min = mfg;
  input.max = max;
  input.value = max;
}

function previewFromForm() {
  const product = state.currentProduct || {};
  const { _id, lotRule, isActive, createdAt, updatedAt, ...fields } = product;
  $("#genCertificatePreview").src = product.catalogueNumber
    ? `/api/certificate-preview.svg?${new URLSearchParams({ ...fields, lotNumber: $("#lotNumber").value, expiryDate: $("#expiryDate").value })}`
    : "";
  fillLabel($("#singleLabelPreview"), {
    productName: product.productName || $("#productName").value || "Puricap PES",
    catalogueNumber: $("#genCatalogue").value || product.catalogueNumber || "OM553-02-02-045",
    membrane: product.membrane || "PES",
    poreSize: product.poreSize || "0.45 + 0.2um",
    lotNumber: $("#lotNumber").value || "S5516E",
    qrImagePath: makePlaceholderQr()
  });
}

function renderLabels(labels) {
  const sheet = $("#labelSheet");
  sheet.replaceChildren();
  updateBatchZipButton(labels);
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
        <label class="bulk-select"><input type="checkbox" data-select-id="${html(label._id)}" aria-label="Select ${html(label.certificateId)}"> ${html(label.certificateId)}</label>
        <div class="label-action-controls">
          <button class="lot-link" type="button" data-view-lot="${html(label.lotNumber)}">Lot ${html(label.lotNumber)}</button>
          ${downloadMenuButton(label)}
          ${can("label:delete") ? `<button class="danger compact" type="button" data-delete-label="${html(label._id)}" data-certificate-id="${html(label.certificateId)}">Delete</button>` : ""}
        </div>
      </div>
    `);
    sheet.append(card);
  });
  updateBulkButtons("#labelSheet");
}

// Bulk actions work on checked [data-select-id] boxes (QR label ids) inside a scope element.
function selectedIds(scope) {
  return $$(`${scope} [data-select-id]:checked`).map((input) => input.dataset.selectId).filter(Boolean);
}

function updateBulkButtons(scope) {
  const count = selectedIds(scope).length;
  const total = $$(`${scope} [data-select-id]`).length;
  $$(`[data-bulk-download="${scope}"]`).forEach((button) => {
    button.disabled = !count;
    button.textContent = count ? `Download selected (${count})` : "Download selected";
  });
  $$(`[data-bulk-delete="${scope}"]`).forEach((button) => {
    button.disabled = !count;
    button.textContent = count ? `Delete selected (${count})` : "Delete selected";
  });
  $$(`[data-select-all="${scope}"]`).forEach((input) => {
    input.checked = Boolean(total) && count === total;
    input.indeterminate = count > 0 && count < total;
  });
}

async function deleteSelected(scope) {
  const ids = selectedIds(scope);
  if (!ids.length || !confirm(`Delete ${ids.length} selected label(s)? This removes the labels and their COA records.`)) return;
  // ponytail: one DELETE per label, sequential; add a bulk endpoint if hundreds get deleted at once.
  let failed = 0;
  for (const id of ids) {
    await api(`/api/qr-labels/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => { failed += 1; });
  }
  const removed = new Set(ids);
  state.generatedLabels = state.generatedLabels.filter((label) => !removed.has(String(label._id)));
  renderLabels(state.generatedLabels);
  if (state.generatedLabels[0]) fillLabel($("#singleLabelPreview"), state.generatedLabels[0]);
  else previewFromForm();
  await Promise.all([loadDashboard(), searchCertificates(), loadBatches()]);
  toast(failed ? `Deleted ${ids.length - failed}, ${failed} failed.` : `Deleted ${ids.length} label(s).`);
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
    lotRule: state.editingLotRule,
    isActive: $("#isActive").checked
  };
}

function setSelect(id, value) {
  $(id).value = value || "";
}

function fillProductForm(product) {
  $("#productId").value = product._id || "";
  state.loadedCatalogue = product.catalogueNumber || "";
  setSelect("#productName", product.productName || "");
  $("#catalogueNumber").value = product.catalogueNumber || "";
  $("#productType").value = product.productType || "Syringe filter";
  $("#category").value = product.category || "Membrane filter";
  $("#company").value = product.company || "Omsons Germany";
  setSelect("#membrane", product.membrane || "");
  setSelect("#poreSize", product.poreSize || "");
  $("#technicalDetail").value = product.technicalDetail || "";
  setSelect("#sterilityType", product.sterilityType || "Non-sterile");
  $("#housing").value = product.housing || "Polypropylene";
  setSelect("#filterDiameter", product.filterDiameter || "");
  $("#burstPressure").value = product.burstPressure || "> 7kg/cm²";
  setSelect("#holdupVolume", product.holdupVolume || "");
  setSelect("#sterilizationMethod", product.sterilizationMethod || "");
  $("#packSize").value = product.packSize || "";
  $("#hsnCode").value = product.hsnCode || "";
  $("#labelTemplate").value = product.labelTemplate || "omsons_sample_v1";
  $("#certificateTemplate").value = product.certificateTemplate || "standard_coa_v1";
  state.editingLotRule = product.lotRule;
  $("#isActive").checked = product.isActive !== false;
  $("#deleteProduct").hidden = !product._id || !can("product:delete");
  refreshProductPreview();
}

// Column headers of public/assets/syringe-filter.xlsx, in sheet order.
const productColumns = ["productName", "productType", "category", "catalogueNumber", "membrane", "poreSize",
  "technicalDetail", "sterilityType", "packSize", "hsnCode", "burstPressure", "company", "filterDiameter",
  "holdupVolume", "housing", "sterilizationMethod"];
const productFilters = {};

function renderProductTableHead() {
  const title = (key) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  $("#productTableHead").innerHTML = `
    <tr class="filter-row">${productColumns.map((key) => `<th><input data-product-filter="${key}" placeholder="${html(title(key))}" aria-label="Filter by ${html(title(key))}"></th>`).join("")}<th>Status</th></tr>`;
}

function renderProductTable() {
  const rows = state.products.filter((product) => Object.entries(productFilters)
    .every(([key, value]) => String(product[key] ?? "").toLowerCase().includes(value)));
  $("#productCount").textContent = `${rows.length} of ${state.products.length}`;
  $("#productRows").innerHTML = rows.map((product) => `
    <tr class="product-row" data-edit-product="${html(product.catalogueNumber)}">
      ${productColumns.map((key) => `<td>${html(product[key])}</td>`).join("")}
      <td><span class="${product.isActive === false ? "status-bad" : "status-valid"}">${product.isActive === false ? "inactive" : "active"}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="${productColumns.length + 1}">No products found.</td></tr>`;
}

// Spreadsheet headers match product fields by name, ignoring case, spaces and punctuation.
const importKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const importFields = new Map([...productColumns, "catalogueNumberVersion"].map((key) => [importKey(key), key]));

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Could not load the spreadsheet reader. Check the internet connection."));
    document.head.append(script);
  });
}

function productsFromSheet(rows) {
  // The template has title rows above the headers, so start at the first row naming catalogueNumber.
  const headerIndex = rows.findIndex((row) => row.some((cell) => importKey(cell) === "cataloguenumber"));
  if (headerIndex < 0) throw new Error("No catalogueNumber column found in the file.");
  const fields = rows[headerIndex].map((cell) => importFields.get(importKey(cell)));
  return rows.slice(headerIndex + 1).map((row) => {
    const record = {};
    fields.forEach((field, index) => { if (field) record[field] = String(row[index] ?? "").trim(); });
    // "catalogueNumber Version" becomes the catalogue number; the sheet's own one is kept hidden as a fallback.
    const { catalogueNumberVersion, ...product } = record;
    if (catalogueNumberVersion) {
      product.originalCatalogueNumber = product.catalogueNumber || "";
      product.catalogueNumber = catalogueNumberVersion;
    }
    return product;
  }).filter((product) => Object.values(product).some(Boolean));
}

async function importProducts(file) {
  const XLSX = await loadSheetJs();
  const workbook = /\.csv$/i.test(file.name)
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer());
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const products = productsFromSheet(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }));
  if (!products.length) throw new Error("No product rows found in the file.");
  const { added, skipped } = await api("/api/products/bulk", { method: "POST", body: JSON.stringify({ products }) });
  await loadProducts();
  const details = skipped.map((row) => `${row.catalogueNumber || "(blank)"}: ${row.error}`).join("\n");
  toast(`Added ${added.length} product(s), skipped ${skipped.length}.${details ? `\n\n${details}` : ""}`);
}

function openProductDialog(product) {
  $("#productSearch").value = "";
  fillProductForm(product);
  $("#productDialog").showModal();
}

async function loadProducts(preferredCatalogue = "") {
  state.products = await api("/api/products");
  renderProductTable();
  $("#productCatalogueList").replaceChildren(...state.products.map((product) =>
    new Option(`${product.productName} - ${product.membrane} - ${product.poreSize}`, product.catalogueNumber)));

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
  const dashboard = await api("/api/dashboard");
  $("#totalProducts").textContent = dashboard.totalProducts;
  $("#totalLabels").textContent = dashboard.totalLabels;
  $("#totalBatches").textContent = dashboard.totalBatches;
  $("#totalCertificates").textContent = dashboard.totalCertificates;
  $("#recentLabels").innerHTML = dashboard.recentLabels.map((label) => `
    <tr>
      <td>${html(label.certificateId)}</td>
      <td>${html(label.catalogueNumber)}</td>
      <td>${html(label.lotNumber)}</td>
      <td class="status-valid">${html(label.status)}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">No labels generated yet.</td></tr>`;
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
async function updateLotBuilder() {
  const params = new URLSearchParams({
    membrane: $("#membrane").value,
    poreSize: $("#poreSize").value,
    sterilityType: $("#sterilityType").value
  });
  const lot = await api(`/api/lots/preview?${params}`);
  $("#lotBuilder").textContent = lot.lotNumber || "----------";
  return lot;
}

let productPreviewTimer;
function refreshProductPreview() {
  clearTimeout(productPreviewTimer);
  productPreviewTimer = setTimeout(async () => {
    try {
      const lot = await updateLotBuilder();
      const { lotRule, isActive, ...fields } = productPayload();
      const params = new URLSearchParams({ ...fields, lotNumber: lot.lotNumber || "" });
      $("#certificatePreview").src = `/api/certificate-preview.svg?${params}`;
    } catch (error) {
      toast(error.message);
    }
  }, 250);
}

const customOptionFields = ["productName", "membrane", "poreSize", "filterDiameter", "holdupVolume", "sterilizationMethod"];

function addCustomOption(field, value) {
  const list = $(`#${field}Options`);
  if ([...list.options].some((option) => option.value === value)) return;
  list.append(new Option("", value));
}

// Typable dropdowns: <input list> + <datalist>. The value is cleared while focused so the
// full option list shows; it comes back on blur if nothing new was typed.
function setupComboboxes() {
  $$("#productForm input.combo").forEach((input) => {
    const placeholder = input.placeholder;
    input.addEventListener("focus", () => {
      input.dataset.saved = input.value;
      input.placeholder = input.value || placeholder;
      input.value = "";
    });
    input.addEventListener("blur", () => {
      if (!input.value.trim()) input.value = input.dataset.saved || "";
      input.value = input.value.trim();
      input.placeholder = placeholder;
      refreshProductPreview();
    });
  });
}

async function setupCustomOptions() {
  setupComboboxes();
  customOptionFields.forEach((field) => {
    const input = $(`#${field}`);
    input.addEventListener("change", () => {
      const value = input.value.trim();
      const known = [...$(`#${field}Options`).options].some((option) => option.value === value);
      if (!value || known) return;
      addCustomOption(field, value);
      api("/api/custom-options", { method: "POST", body: JSON.stringify({ field, value }) })
        .catch((error) => toast(error.message));
    });
  });
  const saved = await api("/api/custom-options");
  saved.forEach(({ field, value }) => customOptionFields.includes(field) && addCustomOption(field, value));
}

async function refreshLotNumber() {
  const catalogue = $("#genCatalogue").value.trim();
  if (!catalogue) return;
  const date = $("#manufacturingDate").value;
  const params = new URLSearchParams({ catalogueNumber: catalogue });
  if (date) params.set("manufacturingDate", date);
  applyExpiry();
  const lot = await api(`/api/lots/suggest?${params}`);
  $("#lotNumber").value = lot.lotNumber;
  $("#lotRulePreview").innerHTML = `<strong>${html(lot.lotNumber)}</strong><br>${html(lot.ruleText)}${lot.serial ? "" : `<br>Month ${html(lot.month)} maps to code ${html(lot.monthCode)}`}`;
  previewFromForm();
}
function updateGenerateButton() {
  $("#generateForm").querySelector('button[type="submit"]').disabled = !state.currentProduct;
}

async function saveProduct(event) {
  event.preventDefault();
  const payload = productPayload();
  // A different catalogue number means a new product, never a rename of the loaded one.
  const isNew = !$("#productId").value ||
    payload.catalogueNumber.trim().toUpperCase() !== state.loadedCatalogue.toUpperCase();
  const saved = await api(isNew ? "/api/products" : `/api/products/${$("#productId").value}`, {
    method: isNew ? "POST" : "PUT",
    body: JSON.stringify(payload)
  });
  fillProductForm(saved);
  renderProductSummary(saved);
  await loadProducts(saved.catalogueNumber);
  await refreshLotNumber();
  await loadDashboard();
  $("#productDialog").close();
  toast(isNew ? "New product added." : "Product saved.");
}

async function deleteProduct() {
  const id = $("#productId").value;
  if (!id || !confirm(`Delete product ${state.loadedCatalogue}? This cannot be undone.`)) return;
  await api(`/api/products/${encodeURIComponent(id)}`, { method: "DELETE" });
  $("#productDialog").close();
  await loadProducts();
  await loadDashboard();
  toast("Product deleted.");
}

function renderPermissionBoxes() {
  $("#userPermissions").insertAdjacentHTML("beforeend", Object.entries(permissionLabels).map(([key, label]) =>
    `<label class="checkbox-row"><input type="checkbox" data-permission="${html(key)}"> ${html(label)}</label>`).join(""));
}

function fillUserForm(user = {}) {
  $("#userId").value = user._id || "";
  $("#userFormTitle").textContent = user._id ? `Edit ${user.username}` : "New User";
  $("#userUsername").value = user.username || "";
  $("#userPassword").value = "";
  $("#userPassword").required = !user._id;
  $("#userPassword").placeholder = user._id ? "Leave blank to keep current password" : "At least 8 characters";
  $$("[data-permission]").forEach((box) => { box.checked = (user.permissions || []).includes(box.dataset.permission); });
  $("#userActive").checked = user.active !== false;
}

async function loadUsers() {
  if (!can("admin")) return;
  state.users = await api("/api/users");
  $("#userRows").innerHTML = state.users.map((user) => `
    <tr>
      <td><strong>${html(user.username)}</strong></td>
      <td>${user.permissions.map((key) => html(permissionLabels[key] || key)).join("<br>") || "View only"}</td>
      <td><span class="${user.active ? "status-valid" : "status-bad"}">${user.active ? "active" : "inactive"}</span></td>
      <td>
        <div class="button-row">
          <button class="secondary compact" type="button" data-edit-user="${html(user._id)}">Edit</button>
          <button class="danger compact" type="button" data-delete-user="${html(user._id)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4">No users yet.</td></tr>`;
}

async function saveUser(event) {
  event.preventDefault();
  const id = $("#userId").value;
  const payload = {
    username: $("#userUsername").value.trim(),
    permissions: $$("[data-permission]:checked").map((box) => box.dataset.permission),
    active: $("#userActive").checked
  };
  if ($("#userPassword").value) payload.password = $("#userPassword").value;
  await api(id ? `/api/users/${encodeURIComponent(id)}` : "/api/users", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload)
  });
  fillUserForm();
  await loadUsers();
  toast(id ? "User updated." : "User created.");
}

async function deleteUser(id) {
  const user = state.users.find((item) => String(item._id) === String(id));
  if (!user || !confirm(`Delete user ${user.username}? They will be signed out immediately.`)) return;
  await api(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  if ($("#userId").value === String(id)) fillUserForm();
  await loadUsers();
}

async function generateLabels(event) {
  event.preventDefault();
  await refreshLotNumber();
  const payload = {
    catalogueNumber: $("#genCatalogue").value,
    lotNumber: $("#lotNumber").value,
    manufacturingDate: $("#manufacturingDate").value,
    expiryDate: $("#expiryDate").value
  };
  const result = await api("/api/qr-batches/generate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.generatedLabels = result.labels;
  renderLabels(result.labels);
  fillLabel($("#singleLabelPreview"), result.labels[0]);
  await refreshLotNumber();
  await loadDashboard();
  await Promise.all([searchCertificates(), loadBatches()]);
  showScreen("labels");
}

function renderCertificateRows(rows) {
  $("#certificateRows").innerHTML = rows.map((certificate) => `
    <tr>
      <td class="select-cell">${certificate.qrLabelId ? `<input type="checkbox" data-select-id="${html(certificate.qrLabelId)}" aria-label="Select ${html(certificate.certificateId)}">` : ""}</td>
      <td>${html(certificate.certificateId)}</td>
      <td>${html(certificate.productName)}</td>
      <td><button class="lot-link" type="button" data-view-lot="${html(certificate.lotNumber)}">${html(certificate.lotNumber)}</button></td>
      <td><a href="/api/certificates/${encodeURIComponent(certificate.certificateId)}/image.webp" target="_blank" rel="noopener">Open COA</a></td>
      <td>${downloadMenuButton(certificate)}</td>
      <td>${can("label:delete") ? `<button class="danger compact" type="button" data-delete-label="${html(certificate.qrLabelId)}" data-certificate-id="${html(certificate.certificateId)}">Delete</button>` : "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="7">No certificate records found.</td></tr>`;
  updateBulkButtons("#certificateRows");
}

async function searchCertificates() {
  const params = new URLSearchParams();
  if ($("#certCatalogue").value) params.set("catalogueNumber", $("#certCatalogue").value);
  if ($("#certLot").value) params.set("lotNumber", $("#certLot").value);
  const rows = await api(`/api/certificates/search?${params}`);
  renderCertificateRows(rows);

  const lotNumber = $("#certLot").value.trim().toUpperCase();
  const lotZipButton = $("#downloadLotZip");
  const lotViewerNote = $("#lotViewerNote");
  lotZipButton.hidden = !lotNumber;
  lotViewerNote.hidden = !lotNumber;
  if (lotNumber) {
    const zipParams = new URLSearchParams({ lotNumber });
    if ($("#certCatalogue").value) zipParams.set("catalogueNumber", $("#certCatalogue").value);
    lotZipButton.dataset.downloadUrl = `/api/qr-labels/zip?${zipParams}`;
  } else {
    delete lotZipButton.dataset.downloadUrl;
  }
  return rows;
}
async function loadBatches() {
  const batches = await api("/api/qr-batches");
  batches.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  $("#batchRows").innerHTML = batches.map((batch) => `
    <tr>
      <td><strong>${html(batch.productName || batch.catalogueNumber)}</strong><br>${html(batch.catalogueNumber)}</td>
      <td><button class="lot-link" type="button" data-view-lot="${html(batch.lotNumber)}">${html(batch.lotNumber || "-")}</button></td>
      <td>${html(batch.quantity)}</td>
      <td>${html(batch.createdAt ? new Date(batch.createdAt).toLocaleString() : "-")}</td>
      <td>
        <div class="button-row">
          <button class="secondary compact" type="button" data-reprint-batch="${html(batch.batchId)}">Reprint</button>
          ${can("label:delete") ? `<button class="danger compact" type="button" data-delete-batch="${html(batch.batchId)}" data-batch-quantity="${html(batch.quantity)}">Delete</button>` : ""}
        </div>
      </td>
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

async function deleteBatch(batchId, quantity) {
  const ok = confirm(
    `Delete this saved batch and its ${quantity || "remaining"} label(s)? ` +
    "This also removes any remaining COA records and QR assets."
  );
  if (!ok) return;

  const result = await api(`/api/qr-batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
  state.generatedLabels = state.generatedLabels.filter((label) => label.batchId !== batchId);
  renderLabels(state.generatedLabels);
  if (state.generatedLabels[0]) fillLabel($("#singleLabelPreview"), state.generatedLabels[0]);
  else previewFromForm();
  await Promise.all([loadDashboard(), searchCertificates(), loadBatches()]);
  toast(`Batch deleted (${result.deletedLabels} label${result.deletedLabels === 1 ? "" : "s"} removed).`);
}

async function deleteLabel(labelId, certificateId) {
  if (!labelId) return toast("This record cannot be deleted because its label ID is missing.");
  const ok = confirm(`Delete ${certificateId}? This removes the label and COA record.`);
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

function bindEvents() {
  $("#logoutButton").addEventListener("click", async () => {
    const button = $("#logoutButton");
    button.disabled = true;
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
      window.location.assign("/login");
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  });

  const setSidebar = (collapsed) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    $("#sidebarToggle").setAttribute("aria-pressed", String(collapsed));
    try { localStorage.setItem("sidebarCollapsed", collapsed ? "1" : ""); } catch {}
  };
  try { setSidebar(localStorage.getItem("sidebarCollapsed") === "1"); } catch {}
  $("#sidebarToggle").addEventListener("click", () =>
    setSidebar(!document.body.classList.contains("sidebar-collapsed")));

  $$(".nav-button").forEach((button) => button.addEventListener("click", () => {
    showScreen(button.dataset.screen);
    if (button.dataset.screen !== "certificates") clearLotViewerUrl();
  }));
  $("#productForm").addEventListener("submit", (event) => saveProduct(event).catch((error) => toast(error.message)));
  $("#addProduct").addEventListener("click", () => openProductDialog({}));
  $("#importProductsButton").addEventListener("click", () => $("#importProducts").click());
  $("#importProducts").addEventListener("change", (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (file) importProducts(file).catch((error) => toast(error.message));
  });
  $("#deleteProduct").addEventListener("click", () => deleteProduct().catch((error) => toast(error.message)));
  $("#userForm").addEventListener("submit", (event) => saveUser(event).catch((error) => toast(error.message)));
  $("#resetUser").addEventListener("click", () => fillUserForm());
  $("#userRows").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-user]");
    if (edit) fillUserForm(state.users.find((user) => String(user._id) === edit.dataset.editUser));
    const remove = event.target.closest("[data-delete-user]");
    if (remove) deleteUser(remove.dataset.deleteUser).catch((error) => toast(error.message));
  });
  $("#closeProductDialog").addEventListener("click", () => $("#productDialog").close());
  // Clicking the dimmed backdrop (the dialog element itself) closes it.
  $("#productDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#productRows").addEventListener("click", (event) => {
    const row = event.target.closest("[data-edit-product]");
    const product = row && state.products.find((item) => item.catalogueNumber === row.dataset.editProduct);
    if (product) openProductDialog(product);
  });
  $("#productTableHead").addEventListener("input", (event) => {
    const key = event.target.dataset.productFilter;
    if (!key) return;
    const value = event.target.value.trim().toLowerCase();
    if (value) productFilters[key] = value;
    else delete productFilters[key];
    renderProductTable();
  });
  $("#clearProductFilters").addEventListener("click", () => {
    $$("[data-product-filter]").forEach((input) => { input.value = ""; });
    Object.keys(productFilters).forEach((key) => delete productFilters[key]);
    renderProductTable();
  });
  $("#resetProduct").addEventListener("click", () => {
    $("#productSearch").value = "";
    fillProductForm({});
  });
  $("#productSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });
  $("#productSearch").addEventListener("input", async () => {
    const query = $("#productSearch").value.trim().toUpperCase();
    const product = state.products.find((item) => item.catalogueNumber === query);
    if (!product) return;
    fillProductForm(product);
    $("#genCatalogue").value = product.catalogueNumber;
    renderProductSummary(product);
    await refreshLotNumber().catch((error) => toast(error.message));
    previewFromForm();
  });
  $("#productForm").addEventListener("input", refreshProductPreview);
  $("#productForm").addEventListener("change", refreshProductPreview);
  $("#certificatePreview").addEventListener("error", () =>
    toast("Certificate preview failed to load. Restart the server and refresh the page."));
  refreshProductPreview();
  $("#manufacturingDate").addEventListener("change", () => refreshLotNumber().catch((error) => toast(error.message)));
  $("#genCatalogue").addEventListener("change", () => lookupProduct().catch((error) => toast(error.message)));
  $("#previewFromForm").addEventListener("click", previewFromForm);
  $("#expiryDate").addEventListener("change", previewFromForm);
  $$("[data-preview-tab]").forEach((tab) => tab.addEventListener("click", () => {
    $$("[data-preview-tab]").forEach((item) => item.classList.toggle("active", item === tab));
    $$("[data-preview-pane]").forEach((pane) => { pane.hidden = pane.dataset.previewPane !== tab.dataset.previewTab; });
  }));
  $("#generateForm").addEventListener("submit", (event) => generateLabels(event).catch((error) => toast(error.message)));
  $("#searchCertificates").addEventListener("click", () => {
    const lotNumber = $("#certLot").value.trim();
    if (lotNumber) setLotViewerUrl(lotNumber, "push");
    else clearLotViewerUrl();
    searchCertificates().catch((error) => toast(error.message));
  });
  $("#printLabels").addEventListener("click", () => window.print());
  $("#downloadBatchZip").addEventListener("click", () => {
    const batchId = $("#downloadBatchZip").dataset.batchId;
    if (batchId) startDownload(`/api/qr-labels/zip?batchId=${encodeURIComponent(batchId)}`);
  });
  $("#downloadLotZip").addEventListener("click", () => {
    const url = $("#downloadLotZip").dataset.downloadUrl;
    if (url) startDownload(url);
  });

  document.addEventListener("click", (event) => {
    const menuButton = event.target.closest("[data-download-menu]");
    if (menuButton) {
      openDownloadMenu(menuButton);
      return;
    }
    if (event.target.closest("[data-download-link]")) {
      window.setTimeout(closeDownloadMenu, 0);
      return;
    }
    if (!event.target.closest("#qrDownloadMenu")) closeDownloadMenu();

    const lotButton = event.target.closest("[data-view-lot]");
    if (lotButton) {
      openLotViewer(lotButton.dataset.viewLot, "push").catch((error) => toast(error.message));
      return;
    }
    const deleteBatchButton = event.target.closest("[data-delete-batch]");
    if (deleteBatchButton) {
      deleteBatch(
        deleteBatchButton.dataset.deleteBatch,
        deleteBatchButton.dataset.batchQuantity
      ).catch((error) => toast(error.message));
      return;
    }
    const reprintButton = event.target.closest("[data-reprint-batch]");
    if (reprintButton) {
      reprintBatch(reprintButton.dataset.reprintBatch).catch((error) => toast(error.message));
      return;
    }
    const deleteButton = event.target.closest("[data-delete-label]");
    if (!deleteButton) return;
    deleteLabel(deleteButton.dataset.deleteLabel, deleteButton.dataset.certificateId)
      .catch((error) => toast(error.message));
  });

  document.addEventListener("change", (event) => {
    const all = event.target.closest("[data-select-all]");
    if (all) {
      $$(`${all.dataset.selectAll} [data-select-id]`).forEach((input) => { input.checked = all.checked; });
      updateBulkButtons(all.dataset.selectAll);
      return;
    }
    if (!event.target.matches("[data-select-id]")) return;
    ["#labelSheet", "#certificateRows"].forEach((scope) => {
      if (event.target.closest(scope)) updateBulkButtons(scope);
    });
  });
  $$("[data-bulk-download]").forEach((button) => button.addEventListener("click", () => {
    const ids = selectedIds(button.dataset.bulkDownload);
    if (ids.length) startDownload(`/api/qr-labels/zip?ids=${encodeURIComponent(ids.join(","))}`);
  }));
  $$("[data-bulk-delete]").forEach((button) => button.addEventListener("click", () =>
    deleteSelected(button.dataset.bulkDelete).catch((error) => toast(error.message))));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDownloadMenu();
  });
  window.addEventListener("resize", closeDownloadMenu);
  window.addEventListener("scroll", closeDownloadMenu, true);
  window.addEventListener("popstate", () => {
    const lotNumber = lotNumberFromLocation();
    if (lotNumber) {
      openLotViewer(lotNumber, null).catch((error) => toast(error.message));
      return;
    }
    $("#certLot").value = "";
    showScreen("dashboard");
    searchCertificates().catch((error) => toast(error.message));
  });
}

async function boot() {
  state.me = await api("/api/me");
  applyPermissions();
  renderProductTableHead();
  renderPermissionBoxes();
  fillUserForm();
  bindEvents();
  const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#manufacturingDate").value = localToday;
  await setupCustomOptions().catch((error) => toast(error.message));
  await loadProducts();
  await loadDashboard();
  await refreshLotNumber().catch(() => {});
  updateGenerateButton();
  previewFromForm();
  await loadBatches();
  await loadUsers();

  const initialLot = lotNumberFromLocation();
  if (initialLot) await openLotViewer(initialLot, "replace");
  else await searchCertificates();

  // Allow deep-linking a tab, e.g. /#screen=generate
  const requested = new URLSearchParams(window.location.hash.slice(1)).get("screen");
  const requestedNav = $(`.nav-button[data-screen="${requested}"]`);
  if (requested && document.getElementById(requested) && !requestedNav?.hidden) showScreen(requested);
}
boot().catch((error) => toast(error.message));


