const certificateId = decodeURIComponent(location.pathname.split("/").pop() || "");
const mount = document.querySelector("#certificateMount");
const downloadPdf = document.querySelector("#downloadPdf");
if (downloadPdf) downloadPdf.href = `/api/certificates/${encodeURIComponent(certificateId)}/pdf`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
}

function isSterile(value) {
  return value && !/^non[\s-]?sterile$/i.test(String(value).trim());
}

function infoSpan(label, value = "") {
  return `<span>${escapeHtml(label)} : <strong>${escapeHtml(value)}</strong></span>`;
}

function renderShell(content) {
  mount.innerHTML = `
    <section class="certificate-page" aria-label="Certificate of Quality">
      <div class="layer-one">
        <div class="header">
          <p style="color: #3FAFE3; font-size: 24px">Certificate of Quality</p>
          <img src="logo.png" alt="Omsons logo" />
        </div>
        ${content}
      </div>
    </section>
  `;
}

function notFound() {
  renderShell(`
    <div class="layer-two" style="">
      <p>Certificate not found</p>
      <div class="cert-error">
        <strong>Certificate not found</strong>
        <span>${escapeHtml(certificateId)}</span>
      </div>
    </div>
  `);
}

function renderCertificate(certificate) {
  const data = certificate.certificateData || {};
  const sterile = isSterile(data.sterilityType);
  const productStatus = sterile ? "Sterile" : "Non-Sterile";
  const membrane = data.membrane || "Nylon";
  const productLine = `${membrane}, Syringe Filters, ${productStatus}`;
  const expiry = formatDate(data.expiryDate);
  const infoFields = [
    ["MAKE", data.company || "Omsons Germany"],
    ["Membrane", data.membrane],
    ["Pore Size", data.poreSize],
    ["Housing", data.housing || ""],
    ["Catalog No.", certificate.catalogueNumber],
    ["Filter Diameter", data.filterDiameter || ""],
    ["Lot No.", certificate.lotNumber],
    ["Burst Pressure", data.burstPressure || ""],
    ...(sterile ? [["Expiry", expiry]] : []),
    ["Holdup Volume", data.holdupVolume || ""],
    ...(sterile ? [["Sterilization", data.sterilizationMethod || data.sterilityType || productStatus]] : [])
  ];

  renderShell(`
    <div class="layer-two" style="">
      <p>Product : ${escapeHtml(productLine)}</p>
      <div class="info">
        ${infoFields.map(([label, value]) => infoSpan(label, value)).join("")}
      </div>

      <div class="details">
        <span style="font-weight: bold; margin-top: 20px;">LOT RELEASE DATA</span>
        <p style="text-align: left;">Before being released, every lot has undergone thorough testing, been sampled, and complied with quality assurance standards &amp; passes following characteristics.</p>
        <div style="text-align: left; Margin-left: 15px; display: flex; justify-content: space-between;">
          <div>
            <li>Integrity</li>
            <li>Flow rate Performance </li>
            <li>Burst Pressure</li>
            <li>Leakage Test</li>
            <li>HPLC Testing </li>
          </div>
          <img src="design.png" alt="Certificate design mark" style="justify-items: right;" />
        </div>
      </div>

      <div class="details">
        <p style="text-align: left; font-weight: bold">Validated for </p>
        <div style="text-align: left; display: grid; grid-column: 1 / 2; grid-template-columns: repeat(2, 1fr); column-gap: 2px">
          <span>Particle Release : </span>
          <span>Passes test as per USP&lt; 788&gt;, particulate matter in injections. </span>
          <span>Fiber Release : </span>
          <span>Complies-Requires No initial flushing. </span>
          ${sterile ? `<span>Sterility :</span><span>Pass</span>` : ""}
        </div>
      </div>

      <div class="details">
        <p style="text-align: left; font-weight: bold">Precautions: </p>
        <div style="text-align: left; display: grid; grid-column: 1 / 1; grid-template-columns: repeat(1, 1fr); column-gap: 2px; Margin-left: 15px">
          <li>During Handling, Avoid Direct Touch to Outlet.</li>
          <li>Wear gloves to avoid contamination.</li>
        </div>
      </div>

      <div class="details">
        <p style="text-align: left; font-weight: bold">Customer Support: </p>
        <div style="text-align: left; display: grid; grid-column: 1 / 1; grid-template-columns: repeat(1, 1fr); column-gap: 2px;">
          <span>Our first goal is your satisfaction. If you require any extra help, you may contact our Team.</span>
        </div>
      </div>

      <div class="details">
        <p style="text-align: left; font-weight: bold">Declaration : </p>
        <div style="text-align: left; display: grid; grid-column: 1 / 1; grid-template-columns: repeat(1, 1fr); column-gap: 2px;">
          <span>The syringe filter have been manufactured in compliance with ISO 9001 regulation using validated production process.</span>
        </div>
      </div>

      <div>
        <div style="display: grid; justify-items: right">
          <img src="signature.png" alt="Authorised signature" />
          <span style="color: #3FAFE3">Authorised Signatory</span>
        </div>
      </div>

      <div style="display: grid;">
        <p style="text-align: left; font-weight: bold">HEAD OFFICE / PLANT </p>
        <div style="text-align: left; display: grid; grid-column: 1 / 1; grid-template-columns: repeat(1, 1fr); column-gap: 2px;">
          <span style="font-size: 12px">Khuda Kalan to Sapehra Road, Vill. Sapehra, P.O. Pilkhani - 133104, Ambala Cantt, Haryana - INDIA</span>
          <span style="font-size: 12px">Contact: sales@omsonsnsi.com | www.omsonslabs.com | +91 82210 01208</span>
        </div>
        <span style="display: flex; font-size: 12px"><p style="font-weight: bold; font-size: 11px">INTERNATIONAL OFFICE :</p> <p> Motorstraße 62, 80809 München, GERMANY</p></span>
      </div>
    </div>
  `);
}

async function loadCertificate() {
  const response = await fetch(`/api/certificates/${encodeURIComponent(certificateId)}`);
  if (!response.ok) return notFound();
  renderCertificate(await response.json());
}

loadCertificate();

