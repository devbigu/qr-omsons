const certificateId = decodeURIComponent(location.pathname.split("/").pop() || "");
const mount = document.querySelector("#catalogueMount");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
}

function value(value, fallback = "-") {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function detail(label, data) {
  return `
    <div class="catalogue-detail">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value(data))}</strong>
    </div>
  `;
}

function notFound() {
  mount.innerHTML = `
    <section class="catalogue-card catalogue-empty">
      <div class="catalogue-brand">OMSONS</div>
      <h1>Catalogue record not found</h1>
      <p>${escapeHtml(certificateId)}</p>
    </section>
  `;
}

function renderCatalogue(record) {
  const product = record.product || {};
  const lot = record.lot || {};
  const qr = record.qr || {};
  const lotBreakdown = lot.lotBreakdown || {};

  mount.innerHTML = `
    <section class="catalogue-hero">
      <div>
        <div class="catalogue-brand">OMSONS</div>
        <p class="catalogue-kicker">Verified product catalogue</p>
        <h1>${escapeHtml(value(product.productName, record.productName || "Product"))}</h1>
        <p class="catalogue-subtitle">${escapeHtml(value(product.productType))} ${product.category ? `- ${escapeHtml(product.category)}` : ""}</p>
      </div>
      <div class="catalogue-status">
        <span>${escapeHtml(value(record.status, "valid"))}</span>
        <strong>${escapeHtml(record.certificateId)}</strong>
      </div>
    </section>

    <section class="catalogue-grid">
      <article class="catalogue-card">
        <h2>Catalogue Details</h2>
        <div class="catalogue-details">
          ${detail("Catalogue number", product.catalogueNumber || record.catalogueNumber)}
          ${detail("Product type", product.productType)}
          ${detail("Category", product.category)}
          ${detail("Membrane", product.membrane)}
          ${detail("Pore size", product.poreSize)}
          ${detail("Technical detail", product.technicalDetail)}
          ${detail("Sterility", product.sterilityType)}
          ${detail("Pack size", product.packSize)}
          ${detail("HSN code", product.hsnCode)}
        </div>
      </article>

      <article class="catalogue-card">
        <h2>Lot Verification</h2>
        <div class="catalogue-details">
          ${detail("Lot number", lot.lotNumber)}
          ${detail("Serial number", lot.serialNumber)}
          ${detail("Manufacturing date", formatDate(lot.manufacturingDate))}
          ${detail("Expiry date", formatDate(lot.expiryDate))}
          ${detail("Lot rule", lotBreakdown.ruleText)}
        </div>
      </article>

      <article class="catalogue-card catalogue-qr-card">
        <h2>Scannable QR</h2>
        ${qr.image ? `<img src="${escapeHtml(qr.image)}" alt="QR code for this catalogue record">` : `<div class="catalogue-qr-placeholder">QR</div>`}
        <p>${escapeHtml(value(qr.url || record.catalogueUrl))}</p>
      </article>

      <article class="catalogue-card catalogue-actions-card">
        <h2>Certificate</h2>
        <a class="secondary-link" href="${escapeHtml(record.coaUrl)}">Open COA</a>
        <a class="secondary-link" href="${escapeHtml(record.pdfUrl)}">Download PDF</a>
        ${qr.dxlUrl ? `<a class="secondary-link" href="${escapeHtml(qr.dxlUrl)}">Open QR DXL</a>` : ""}
      </article>
    </section>
  `;
}

async function loadCatalogue() {
  const response = await fetch(`/api/catalogue/${encodeURIComponent(certificateId)}`);
  if (!response.ok) return notFound();
  renderCatalogue(await response.json());
}

loadCatalogue().catch(notFound);
