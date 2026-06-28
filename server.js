const express = require("express");
const QRCode = require("qrcode");
const { MongoClient, ObjectId } = require("mongodb");
const { promises: fs } = require("fs");
const fsSync = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const crypto = require("crypto");
const { promisify } = require("util");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fsSync.existsSync(envPath)) return;

  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();
const execFileAsync = promisify(execFile);

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function resolvePath(value, fallback) {
  return value ? path.resolve(value) : fallback;
}

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = resolvePath(process.env.DATA_DIR, path.join(__dirname, "data"));
const dataFile = path.join(dataDir, "store.json");
const certificateTemplateFile = resolvePath(
  process.env.CERTIFICATE_TEMPLATE_FILE,
  path.join(__dirname, "data", "templates", "syringe-filter-certificate.pdf")
);
const certificateImageTemplates = {
  sterile: path.join(__dirname, "data", "templates", "certificate-sterile.png"),
  nonSterile: path.join(__dirname, "data", "templates", "certificate-non-sterile.png")
};
const certificateOutputDir = path.join(dataDir, "certificates");
const certificateRenderScript = path.join(__dirname, "scripts", "render_certificate_pdf.py");
const pythonExecutable = process.env.PYTHON || "python";
const cloudinary = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_FOLDER || "omsons-qr-labels"
};

app.disable("x-powered-by");
if (envFlag("TRUST_PROXY", process.env.NODE_ENV === "production")) {
  app.set("trust proxy", 1);
}
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

const now = () => new Date().toISOString();
const slug = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const normaliseCatalogue = (value = "") => value.trim().toUpperCase();
const serialToNumber = (value) => Number.parseInt(value, 10);
const defaultMonthCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

function parseDateInput(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function monthCodeFor(rule = {}, date = new Date()) {
  const codes = Array.isArray(rule.monthCodes) && rule.monthCodes.length === 12 ? rule.monthCodes : defaultMonthCodes;
  return codes[date.getMonth()] || defaultMonthCodes[date.getMonth()];
}

function suggestLot(product, manufacturingDate) {
  const rule = product.lotRule || {};
  const date = parseDateInput(manufacturingDate);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  const monthCode = monthCodeFor(rule, date);
  const productCode = String(rule.productCode || "55").trim();
  const prefix = rule.prefix === undefined ? "S" : String(rule.prefix);
  const dateFormat = rule.dateFormat === "DDMMYY" ? "DDMMYY" : "DDM";
  const dateCode = dateFormat === "DDMMYY" ? `${day}${month}${year}` : `${day}${monthCode}`;

  return {
    lotNumber: `${prefix}${productCode}${dateCode}`,
    prefix,
    productCode,
    day,
    month,
    year,
    monthCode,
    dateCode,
    dateFormat,
    ruleText: `${prefix} + product code ${productCode} + day ${day} + month code ${monthCode}`
  };
}

const defaultProduct = {
  productName: "Nylon Syringe Filters",
  productType: "Syringe filter",
  category: "Membrane filter",
  catalogueNumber: "OM260-020",
  company: "Omsons Germany",
  membrane: "Nylon",
  poreSize: "0.45µm",
  technicalDetail: "",
  sterilityType: "Non-sterile",
  housing: "Polypropylene",
  filterDiameter: "25",
  burstPressure: "> 7kg/cm²",
  holdupVolume: "< 50µl",
  sterilizationMethod: "",
  packSize: "",
  hsnCode: "",
  image: "",
  labelTemplate: "omsons_sample_v1",
  certificateTemplate: "standard_coa_v1",
  lotRule: {
    prefix: "S",
    suffix: "",
    productCode: "55",
    dateFormat: "DDM",
    monthCodes: defaultMonthCodes,
    allowManualOverride: true
  },
  isActive: true
};

function printablePore(product) {
  return product.poreSize || product.technicalDetail || "";
}

function publicBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function buildCertificateId(catalogueNumber, lotNumber, serialNumber) {
  const cat = normaliseCatalogue(catalogueNumber).split("-")[0] || "OMSONS";
  return `CERT-${cat}-${lotNumber}-${serialNumber}`;
}

function hasCloudinaryConfig() {
  return Boolean(cloudinary.cloudName && cloudinary.apiKey && cloudinary.apiSecret);
}

function hasPartialCloudinaryConfig() {
  return Boolean(cloudinary.cloudName || cloudinary.apiKey || cloudinary.apiSecret) && !hasCloudinaryConfig();
}

function safeCloudinaryId(value) {
  return String(value || "qr")
    .replace(/[^a-zA-Z0-9/_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cloudinarySignature(params) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHash("sha1").update(`${payload}${cloudinary.apiSecret}`).digest("hex");
}

async function uploadToCloudinary(buffer, options) {
  if (hasPartialCloudinaryConfig()) {
    throw new Error("Cloudinary is partially configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }
  if (!hasCloudinaryConfig()) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder: cloudinary.folder,
    overwrite: true,
    public_id: options.publicId,
    timestamp
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.append(key, String(value));
  form.append("api_key", cloudinary.apiKey);
  form.append("signature", cloudinarySignature(params));
  form.append("file", new Blob([buffer], { type: options.contentType }), options.fileName);

  const resourceType = options.resourceType || "image";
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/${resourceType}/upload`, {
    method: "POST",
    body: form
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || "Cloudinary upload failed.");
  }
  return body;
}

async function destroyCloudinaryAsset(publicId, resourceType = "image") {
  if (!publicId || !hasCloudinaryConfig()) return;

  const params = {
    invalidate: true,
    public_id: publicId,
    timestamp: Math.floor(Date.now() / 1000)
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.append(key, String(value));
  form.append("api_key", cloudinary.apiKey);
  form.append("signature", cloudinarySignature(params));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/${resourceType}/destroy`, {
    method: "POST",
    body: form
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || "Cloudinary deletion failed.");
}

function dxfNumber(value) {
  return Number(value.toFixed(6)).toString();
}

function dxfComment(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7E]/g, "?");
}

function buildQrDxf({ certificateId, qrUrl }) {
  const qr = QRCode.create(qrUrl, { errorCorrectionLevel: "M" });
  const moduleCount = qr.modules.size;
  const quietZone = 4;
  const drawingSizeMm = 25;
  const moduleSize = drawingSizeMm / (moduleCount + quietZone * 2);
  const lines = [
    "999", `QR code for ${dxfComment(certificateId)}`,
    "999", `Verification URL: ${dxfComment(qrUrl)}`,
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "9", "$INSUNITS",
    "70", "4",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "ENTITIES"
  ];

  const addSolid = (startColumn, endColumn, row) => {
    const x1 = (quietZone + startColumn) * moduleSize;
    const x2 = (quietZone + endColumn) * moduleSize;
    const y1 = (quietZone + moduleCount - row - 1) * moduleSize;
    const y2 = y1 + moduleSize;
    lines.push(
      "0", "SOLID",
      "8", "QR_DARK",
      "10", dxfNumber(x1), "20", dxfNumber(y1), "30", "0",
      "11", dxfNumber(x2), "21", dxfNumber(y1), "31", "0",
      "12", dxfNumber(x1), "22", dxfNumber(y2), "32", "0",
      "13", dxfNumber(x2), "23", dxfNumber(y2), "33", "0"
    );
  };

  for (let row = 0; row < moduleCount; row += 1) {
    let runStart = -1;
    for (let column = 0; column <= moduleCount; column += 1) {
      const isDark = column < moduleCount && qr.modules.get(row, column);
      if (isDark && runStart === -1) runStart = column;
      if (!isDark && runStart !== -1) {
        addSolid(runStart, column, row);
        runStart = -1;
      }
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

async function createQrAssets(qrUrl, certificateId) {
  const qrOptions = { margin: 0, width: 240, errorCorrectionLevel: "M" };
  const dxf = buildQrDxf({ certificateId, qrUrl });
  const pngDataUrl = await QRCode.toDataURL(qrUrl, qrOptions);
  const assets = {
    qrImagePath: pngDataUrl,
    qrImageCloudinaryUrl: "",
    qrImagePublicId: "",
    qrDxfUrl: "",
    qrDxfPublicId: "",
    qrDxfFormat: "dxf"
  };

  if (!hasCloudinaryConfig()) {
    if (hasPartialCloudinaryConfig()) await uploadToCloudinary(Buffer.alloc(0), { publicId: "config-check" });
    return assets;
  }

  const safeId = safeCloudinaryId(certificateId);
  const dxfUpload = await uploadToCloudinary(Buffer.from(dxf, "utf8"), {
    resourceType: "raw",
    publicId: `qr/dxf/${safeId}.dxf`,
    fileName: `${safeId}.dxf`,
    contentType: "image/vnd.dxf"
  });
  assets.qrDxfUrl = dxfUpload.secure_url || dxfUpload.url || "";
  assets.qrDxfPublicId = dxfUpload.public_id || "";

  const pngBuffer = Buffer.from(pngDataUrl.split(",")[1], "base64");
  const pngUpload = await uploadToCloudinary(pngBuffer, {
    resourceType: "image",
    publicId: `qr/images/${safeId}`,
    fileName: `${safeId}.png`,
    contentType: "image/png"
  });
  assets.qrImagePath = pngUpload.secure_url || pngUpload.url || pngDataUrl;
  assets.qrImageCloudinaryUrl = pngUpload.secure_url || pngUpload.url || "";
  assets.qrImagePublicId = pngUpload.public_id || "";

  return assets;
}

function makeBatchId() {
  return `BATCH-${Date.now()}-${slug()}`;
}

function cleanProduct(payload) {
  const catalogueNumber = normaliseCatalogue(payload.catalogueNumber);
  if (!catalogueNumber) throw new Error("Catalogue number is required.");
  if (!payload.productName?.trim()) throw new Error("Product name is required.");

  return {
    productName: payload.productName.trim(),
    productType: payload.productType?.trim() || "Syringe filter",
    category: payload.category?.trim() || "Membrane filter",
    catalogueNumber,
    company: payload.company?.trim() || "Omsons Germany",
    membrane: payload.membrane?.trim() || "",
    poreSize: payload.poreSize?.trim() || "",
    technicalDetail: payload.technicalDetail?.trim() || "",
    sterilityType: payload.sterilityType?.trim() || "",
    housing: payload.housing?.trim() || "",
    filterDiameter: payload.filterDiameter?.trim() || "",
    burstPressure: payload.burstPressure?.trim() || "",
    holdupVolume: payload.holdupVolume?.trim() || "",
    sterilizationMethod: payload.sterilizationMethod?.trim() || "",
    packSize: payload.packSize?.trim() || "",
    hsnCode: payload.hsnCode?.trim() || "",
    image: payload.image?.trim() || "",
    labelTemplate: payload.labelTemplate?.trim() || "omsons_sample_v1",
    certificateTemplate: payload.certificateTemplate?.trim() || "standard_coa_v1",
    lotRule: {
      prefix: payload.lotRule?.prefix ?? "S",
      suffix: payload.lotRule?.suffix || "",
      productCode: payload.lotRule?.productCode || "55",
      dateFormat: payload.lotRule?.dateFormat || "DDM",
      monthCodes: Array.isArray(payload.lotRule?.monthCodes) && payload.lotRule.monthCodes.length === 12
        ? payload.lotRule.monthCodes
        : defaultMonthCodes,
      allowManualOverride: payload.lotRule?.allowManualOverride !== false
    },
    isActive: payload.isActive !== false
  };
}

class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.data = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      this.data = {
        products: [],
        lots: [],
        qr_batches: [],
        qr_labels: [],
        certificates: []
      };
      await this.save();
    }
  }

  async save() {
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2));
  }

  matches(predicate) {
    if (typeof predicate === "function") return predicate;
    return (row) => Object.entries(predicate || {}).every(([key, value]) => String(row[key]) === String(value));
  }

  async list(collection, predicate = {}) {
    return this.data[collection].filter(this.matches(predicate));
  }

  async findOne(collection, predicate) {
    return this.data[collection].find(this.matches(predicate)) || null;
  }

  async insert(collection, doc) {
    const saved = { _id: `${collection}_${slug()}`, ...doc };
    this.data[collection].push(saved);
    await this.save();
    return saved;
  }

  async update(collection, id, patch) {
    const rows = this.data[collection];
    const index = rows.findIndex((row) => String(row._id) === String(id));
    if (index === -1) return null;
    rows[index] = { ...rows[index], ...patch, updatedAt: now() };
    await this.save();
    return rows[index];
  }

  async delete(collection, id) {
    const before = this.data[collection].length;
    this.data[collection] = this.data[collection].filter((row) => String(row._id) !== String(id));
    await this.save();
    return before !== this.data[collection].length;
  }

  async deleteMany(collection, predicate = {}) {
    const before = this.data[collection].length;
    this.data[collection] = this.data[collection].filter((row) => !this.matches(predicate)(row));
    await this.save();
    return before - this.data[collection].length;
  }
}

class MongoStore {
  constructor(uri) {
    this.uri = uri;
  }

  async init() {
    this.client = new MongoClient(this.uri, {
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 10000),
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000),
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
      minPoolSize: 0,
      retryReads: true,
      retryWrites: true,
      family: Number(process.env.MONGODB_FAMILY || 4)
    });
    await this.client.connect();
    this.db = this.client.db(process.env.MONGODB_DB || "omsons_qr");
    await this.db.collection("products").createIndex({ catalogueNumber: 1 }, { unique: true });
    await this.db.collection("qr_labels").createIndex(
      { catalogueNumber: 1, lotNumber: 1, serialNumber: 1 },
      { unique: true }
    );

  }

  collection(name) {
    return this.db.collection(name);
  }

  idFilter(id) {
    return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
  }

  async list(collection, predicate = {}) {
    return this.collection(collection).find(predicate).sort({ createdAt: -1 }).toArray();
  }

  async findOne(collection, predicate) {
    const filter = predicate?._id && ObjectId.isValid(predicate._id)
      ? { ...predicate, _id: new ObjectId(predicate._id) }
      : predicate;
    return this.collection(collection).findOne(filter);
  }

  async insert(collection, doc) {
    const result = await this.collection(collection).insertOne(doc);
    return { _id: result.insertedId, ...doc };
  }

  async update(collection, id, patch) {
    const result = await this.collection(collection).findOneAndUpdate(
      this.idFilter(id),
      { $set: { ...patch, updatedAt: now() } },
      { returnDocument: "after" }
    );
    return result;
  }

  async delete(collection, id) {
    const result = await this.collection(collection).deleteOne(this.idFilter(id));
    return result.deletedCount > 0;
  }

  async deleteMany(collection, predicate = {}) {
    const result = await this.collection(collection).deleteMany(predicate);
    return result.deletedCount;
  }
}

let store;
let storeInitPromise;
let storeInitError;
let nextStoreRetryAt = 0;

function createStore() {
  if (process.env.STORAGE_MODE === 'json') return new JsonStore(dataFile);
  if (process.env.MONGODB_URI) return new MongoStore(process.env.MONGODB_URI);
  return new JsonStore(dataFile);
}

function storageErrorSummary(error) {
  return `${error?.name || "Error"}: ${error?.message || "Unknown storage error"}`;
}

async function initialiseStore() {
  if (store) return store;
  if (storeInitPromise) return storeInitPromise;

  if (storeInitError && Date.now() < nextStoreRetryAt) throw storeInitError;

  const candidate = createStore();
  storeInitPromise = candidate.init()
    .then(() => {
      store = candidate;
      storeInitError = undefined;
      nextStoreRetryAt = 0;
      return store;
    })
    .catch(async (error) => {
      storeInitError = error;
      nextStoreRetryAt = Date.now() + Number(process.env.STORAGE_RETRY_DELAY_MS || 5000);
      storeInitPromise = undefined;
      if (candidate instanceof MongoStore && candidate.client) {
        await candidate.client.close().catch(() => {});
      }
      throw error;
    });

  return storeInitPromise;
}

function safeCertificateFileName(certificateId) {
  return String(certificateId || "certificate").replace(/[^a-zA-Z0-9._-]/g, "_");
}

const certificateTemplateCache = new Map();

function isSterileCertificate(certificate) {
  const value = String(certificate.certificateData?.sterilityType || "").trim();
  return Boolean(value) && !/^non[\s-]?sterile$/i.test(value);
}

function formatCertificateDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function certificateSvgText(x, y, value, size = 24, maxChars = 44) {
  let text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return `<text x="${x}" y="${y}" font-size="${size}">${xmlEscape(text)}</text>`;
}

async function buildCertificateSvg(certificate) {
  const data = certificate.certificateData || {};
  const sterile = isSterileCertificate(certificate);
  const templatePath = sterile ? certificateImageTemplates.sterile : certificateImageTemplates.nonSterile;
  let templateBase64 = certificateTemplateCache.get(templatePath);
  if (!templateBase64) {
    templateBase64 = (await fs.readFile(templatePath)).toString("base64");
    certificateTemplateCache.set(templatePath, templateBase64);
  }

  const productStatus = sterile ? "Sterile" : "Non-Sterile";
  const productMembrane = data.membrane || certificate.productName || "Nylon";
  const productLine = `Product : ${productMembrane}, Syringe Filters, ${productStatus}`;
  const fields = [
    certificateSvgText(300, 364, data.company || "Omsons", 24, 28),
    certificateSvgText(300, 404, data.poreSize, 24, 28),
    certificateSvgText(300, 442, certificate.catalogueNumber, 24, 32),
    certificateSvgText(300, 482, certificate.lotNumber, 24, 28),
    sterile ? certificateSvgText(300, 520, formatCertificateDate(data.expiryDate), 24, 24) : "",
    sterile ? certificateSvgText(300, 560, data.sterilizationMethod || data.sterilityType || "Sterile", 24, 30) : "",
    certificateSvgText(810, 364, data.membrane, 24, 28),
    certificateSvgText(810, 404, data.housing, 24, 28),
    certificateSvgText(810, 442, data.filterDiameter, 24, 28),
    certificateSvgText(810, 482, data.burstPressure, 24, 28),
    certificateSvgText(810, 520, data.holdupVolume, 24, 28)
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1227" height="1720" viewBox="0 0 1227 1720">
  <image width="1227" height="1720" href="data:image/png;base64,${templateBase64}" />
  <rect x="116" y="264" width="648" height="52" fill="#fff" />
  <g fill="#1a1a18" font-family="Arial, Helvetica, sans-serif">
    ${certificateSvgText(128, 308, productLine, 32, 56)}
    ${fields}
  </g>
</svg>`;
}

function certificateDeliveryUrl(secureUrl, format) {
  const normalizedFormat = format === "jpg" || format === "jpeg" ? "jpg" : "webp";
  const transformation = normalizedFormat === "jpg" ? "f_jpg,q_auto:good" : "f_webp,q_auto";
  return secureUrl
    .replace("/upload/", `/upload/${transformation}/`)
    .replace(/\.svg(\?.*)?$/i, `.${normalizedFormat}$1`);
}

async function ensureCertificateImage(certificate) {
  if (certificate.certificateImageCloudinaryUrl && certificate.certificateImagePublicId) {
    return {
      secureUrl: certificate.certificateImageCloudinaryUrl,
      publicId: certificate.certificateImagePublicId
    };
  }
  if (!hasCloudinaryConfig()) throw new Error("Cloudinary is required for certificate images.");

  const safeId = safeCloudinaryId(certificate.certificateId);
  const svg = await buildCertificateSvg(certificate);
  const uploaded = await uploadToCloudinary(Buffer.from(svg), {
    resourceType: "image",
    publicId: `certificates/${safeId}`,
    fileName: `${safeId}.svg`,
    contentType: "image/svg+xml"
  });
  const imagePatch = {
    certificateImageCloudinaryUrl: uploaded.secure_url,
    certificateImagePublicId: uploaded.public_id
  };
  await store.update("certificates", certificate._id, imagePatch);
  const label = await store.findOne("qr_labels", { certificateId: certificate.certificateId });
  if (label) await store.update("qr_labels", label._id, imagePatch);

  return { secureUrl: uploaded.secure_url, publicId: uploaded.public_id };
}

async function renderCertificatePdf(certificate) {
  if (!fsSync.existsSync(certificateTemplateFile)) {
    throw new Error("Certificate PDF template is missing.");
  }

  await fs.mkdir(certificateOutputDir, { recursive: true });
  const safeName = safeCertificateFileName(certificate.certificateId);
  const payloadPath = path.join(certificateOutputDir, `${safeName}.json`);
  const outputPath = path.join(certificateOutputDir, `${safeName}.pdf`);

  await fs.writeFile(payloadPath, JSON.stringify(certificate, null, 2));
  await execFileAsync(
    pythonExecutable,
    [certificateRenderScript, payloadPath, certificateTemplateFile, outputPath],
    {
      cwd: __dirname,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }
  );

  return outputPath;
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function findProductByCatalogue(catalogueNumber) {
  const normalised = normaliseCatalogue(catalogueNumber);
  return store.findOne("products", { catalogueNumber: normalised });
}

app.get("/api/health", asyncRoute(async (req, res) => {
  try {
    await initialiseStore();
    res.json({
      ok: true,
      storage: store instanceof MongoStore ? "mongodb" : "json",
      cloudinary: hasCloudinaryConfig() ? "configured" : "not_configured"
    });
  } catch (error) {
    console.error("Storage health check failed:", storageErrorSummary(error));
    res.status(503).json({
      ok: false,
      storage: "unavailable",
      cloudinary: hasCloudinaryConfig() ? "configured" : "not_configured",
      error: "Database connection unavailable."
    });
  }
}));

app.use("/api", asyncRoute(async (req, res, next) => {
  try {
    await initialiseStore();
    next();
  } catch (error) {
    console.error("Storage initialization failed:", storageErrorSummary(error));
    res.status(503).json({ error: "Database connection unavailable. Please try again shortly." });
  }
}));

app.get("/api/dashboard", asyncRoute(async (req, res) => {
  const [products, batches, labels, certificates] = await Promise.all([
    store.list("products"),
    store.list("qr_batches"),
    store.list("qr_labels"),
    store.list("certificates")
  ]);
  res.json({
    totalProducts: products.length,
    totalBatches: batches.length,
    totalLabels: labels.length,
    totalCertificates: certificates.length,
    recentLabels: labels.slice(-8).reverse()
  });
}));

app.post("/api/products", asyncRoute(async (req, res) => {
  const product = cleanProduct(req.body);
  const existing = await findProductByCatalogue(product.catalogueNumber);
  if (existing) return res.status(409).json({ error: "Catalogue number already exists." });
  const saved = await store.insert("products", { ...product, createdAt: now(), updatedAt: now() });
  res.status(201).json(saved);
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  const q = req.query.q?.toString().trim().toUpperCase();
  const products = await store.list("products");
  const filtered = q
    ? products.filter((product) =>
      [product.catalogueNumber, product.productName, product.membrane]
        .join(" ")
        .toUpperCase()
        .includes(q))
    : products;
  res.json(filtered);
}));

app.get("/api/products/search", asyncRoute(async (req, res) => {
  const product = await findProductByCatalogue(req.query.catalogueNumber || "");
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json(product);
}));

app.get("/api/products/:id", asyncRoute(async (req, res) => {
  const product = await store.findOne("products", { _id: req.params.id });
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json(product);
}));

app.put("/api/products/:id", asyncRoute(async (req, res) => {
  const product = cleanProduct(req.body);
  const updated = await store.update("products", req.params.id, product);
  if (!updated) return res.status(404).json({ error: "Product not found." });
  res.json(updated);
}));

app.delete("/api/products/:id", asyncRoute(async (req, res) => {
  const product = await store.findOne("products", { _id: req.params.id });
  if (!product) return res.status(404).json({ error: "Product not found." });

  const labels = await store.list("qr_labels", { catalogueNumber: product.catalogueNumber });
  if (labels.length) {
    return res.status(409).json({ error: "Delete this product's labels before deleting the product." });
  }

  await store.deleteMany("lots", { catalogueNumber: product.catalogueNumber });
  await store.delete("products", req.params.id);
  res.status(204).send();
}));

app.post("/api/lots", asyncRoute(async (req, res) => {
  const product = await findProductByCatalogue(req.body.catalogueNumber || "");
  if (!product) return res.status(404).json({ error: "Product not found." });
  const lotNumber = req.body.lotNumber?.trim();
  if (!lotNumber) return res.status(400).json({ error: "Lot number is required." });

  const existing = await store.findOne("lots", { catalogueNumber: product.catalogueNumber, lotNumber });
  if (existing) return res.json(existing);

  const lot = await store.insert("lots", {
    productId: product._id,
    catalogueNumber: product.catalogueNumber,
    lotNumber,
    manufacturingDate: req.body.manufacturingDate || "",
    expiryDate: req.body.expiryDate || "",
    monthCode: req.body.monthCode || "",
    yearCode: req.body.yearCode || "",
    productCode: req.body.productCode || product.lotRule?.productCode || "",
    createdBy: "admin",
    createdAt: now()
  });
  res.status(201).json(lot);
}));

app.get("/api/lots", asyncRoute(async (req, res) => {
  const catalogueNumber = normaliseCatalogue(req.query.catalogueNumber || "");
  const lots = await store.list("lots");
  res.json(catalogueNumber ? lots.filter((lot) => lot.catalogueNumber === catalogueNumber) : lots);
}));
app.get("/api/lots/suggest", asyncRoute(async (req, res) => {
  const product = await findProductByCatalogue(req.query.catalogueNumber || "");
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json(suggestLot(product, req.query.manufacturingDate));
}));

app.get("/api/lots/:id", asyncRoute(async (req, res) => {
  const lot = await store.findOne("lots", { _id: req.params.id });
  if (!lot) return res.status(404).json({ error: "Lot not found." });
  res.json(lot);
}));

app.get("/api/qr-batches", asyncRoute(async (req, res) => {
  const batches = await store.list("qr_batches");
  res.json(batches.map((batch) => ({
    ...batch,
    _id: String(batch._id),
    productId: batch.productId ? String(batch.productId) : "",
    lotId: batch.lotId ? String(batch.lotId) : ""
  })));
}));

app.post("/api/qr-batches/generate", asyncRoute(async (req, res) => {
  const product = await findProductByCatalogue(req.body.catalogueNumber || "");
  if (!product) return res.status(404).json({ error: "Product not found." });

  const suggestedLot = suggestLot(product, req.body.manufacturingDate);
  const lotNumber = req.body.lotNumber?.trim() || suggestedLot.lotNumber;
  const startSerial = serialToNumber(req.body.startSerial);
  const quantity = req.body.quantity ? serialToNumber(req.body.quantity) : null;
  const endSerial = req.body.endSerial ? serialToNumber(req.body.endSerial) : startSerial + quantity - 1;

  if (!lotNumber) return res.status(400).json({ error: "Lot number is required." });
  if (!Number.isInteger(startSerial) || startSerial <= 0) return res.status(400).json({ error: "Start serial must be a positive number." });
  if (!Number.isInteger(endSerial) || endSerial < startSerial) return res.status(400).json({ error: "End serial must be equal to or greater than start serial." });
  if (endSerial - startSerial > 299) return res.status(400).json({ error: "Generate up to 300 labels per batch." });

  let lot = await store.findOne("lots", { catalogueNumber: product.catalogueNumber, lotNumber });
  if (!lot) {
    lot = await store.insert("lots", {
      productId: product._id,
      catalogueNumber: product.catalogueNumber,
      lotNumber,
      manufacturingDate: req.body.manufacturingDate || "",
      expiryDate: req.body.expiryDate || "",
      monthCode: suggestedLot.monthCode,
      yearCode: suggestedLot.year,
      productCode: product.lotRule?.productCode || "",
      lotBreakdown: suggestedLot,
      createdBy: "admin",
      createdAt: now()
    });
  }

  const lotBreakdown = lot.lotBreakdown || suggestedLot;
  const serials = Array.from({ length: endSerial - startSerial + 1 }, (_, index) => startSerial + index);
  const existing = await store.list("qr_labels");
  const duplicates = serials.filter((serialNumber) =>
    existing.some((label) =>
      label.catalogueNumber === product.catalogueNumber &&
      label.lotNumber === lotNumber &&
      Number(label.serialNumber) === serialNumber));
  if (duplicates.length) {
    return res.status(409).json({
      error: "Duplicate serial numbers for this catalogue and lot.",
      duplicates
    });
  }

  const batchId = makeBatchId();
  const batch = await store.insert("qr_batches", {
    batchId,
    productId: product._id,
    lotId: lot._id,
    catalogueNumber: product.catalogueNumber,
    productName: product.productName,
    lotNumber,
    startSerial,
    endSerial,
    quantity: serials.length,
    generatedBy: "admin",
    createdAt: now()
  });

  const labels = [];
  for (const serialNumber of serials) {
    const certificateId = buildCertificateId(product.catalogueNumber, lotNumber, serialNumber);
    const qrUrl = `${publicBaseUrl(req)}/api/certificates/${encodeURIComponent(certificateId)}/image.webp`;
    const qrAssets = await createQrAssets(qrUrl, certificateId);
    const label = await store.insert("qr_labels", {
      batchId: batch.batchId,
      batchRecordId: batch._id,
      productId: product._id,
      lotId: lot._id,
      certificateId,
      catalogueNumber: product.catalogueNumber,
      productName: product.productName,
      membrane: product.membrane,
      poreSize: printablePore(product),
      technicalDetail: product.technicalDetail,
      lotNumber,
      lotBreakdown,
      serialNumber,
      qrUrl,
      qrImagePath: qrAssets.qrImagePath,
      qrImageCloudinaryUrl: qrAssets.qrImageCloudinaryUrl,
      qrImagePublicId: qrAssets.qrImagePublicId,
      qrDxfUrl: qrAssets.qrDxfUrl,
      qrDxfPublicId: qrAssets.qrDxfPublicId,
      qrDxfFormat: qrAssets.qrDxfFormat,
      labelPdfPath: "",
      certificatePdfPath: "",
      status: "valid",
      createdAt: now()
    });
    await store.insert("certificates", {
      batchId: batch.batchId,
      certificateId,
      productId: product._id,
      lotId: lot._id,
      qrLabelId: String(label._id),
      catalogueNumber: product.catalogueNumber,
      productName: product.productName,
      lotNumber,
      serialNumber,
      certificateData: {
        productType: product.productType,
        category: product.category,
        gtap: product.technicalDetail,
        membrane: product.membrane,
        poreSize: printablePore(product),
        sterilityType: product.sterilityType,
        housing: product.housing || "",
        filterDiameter: product.filterDiameter || "",
        burstPressure: product.burstPressure || "",
        holdupVolume: product.holdupVolume || "",
        sterilizationMethod: product.sterilizationMethod || "",
        packSize: product.packSize,
        hsnCode: product.hsnCode,
        manufacturingDate: lot.manufacturingDate || "",
        expiryDate: lot.expiryDate || "",
        lotBreakdown,
        certificateTemplate: product.certificateTemplate,
        company: product.company || "Omsons Germany"
      },
      certificatePdfPath: "",
      qrDxfUrl: qrAssets.qrDxfUrl,
      verificationUrl: qrUrl,
      status: "valid",
      createdAt: now()
    });
    labels.push(label);
  }

  res.status(201).json({
    batchId: batch.batchId,
    batchRecordId: batch._id,
    lotBreakdown,
    totalGenerated: labels.length,
    labels
  });
}));

app.get("/api/qr-labels", asyncRoute(async (req, res) => {
  const labels = await store.list("qr_labels");
  const catalogueNumber = normaliseCatalogue(req.query.catalogueNumber || "");
  const lotNumber = req.query.lotNumber?.toString().trim().toUpperCase();
  const batchId = req.query.batchId?.toString().trim();
  res.json(labels.filter((label) =>
    (!catalogueNumber || label.catalogueNumber === catalogueNumber) &&
    (!lotNumber || label.lotNumber === lotNumber) &&
    (!batchId || label.batchId === batchId)));
}));

async function cleanupLabelArtifacts(labels) {
  const warnings = [];
  const chunkSize = 10;

  for (let index = 0; index < labels.length; index += chunkSize) {
    const tasks = labels.slice(index, index + chunkSize).flatMap((label) => {
      const labelTasks = [
        destroyCloudinaryAsset(label.qrImagePublicId, "image"),
        destroyCloudinaryAsset(label.qrDxfPublicId || label.qrDxlPublicId, "raw"),
        destroyCloudinaryAsset(label.certificateImagePublicId, "image")
      ];

      if (label.certificateId) {
        const safeName = safeCertificateFileName(label.certificateId);
        labelTasks.push(
          fs.rm(path.join(certificateOutputDir, `${safeName}.pdf`), { force: true }),
          fs.rm(path.join(certificateOutputDir, `${safeName}.json`), { force: true })
        );
      }

      return labelTasks;
    });

    const results = await Promise.allSettled(tasks);
    results
      .filter((result) => result.status === "rejected")
      .forEach((result) => warnings.push(result.reason?.message || String(result.reason)));
  }

  warnings.forEach((warning) => console.warn(`Artifact cleanup warning: ${warning}`));
  return warnings;
}

app.delete("/api/qr-labels/:id", asyncRoute(async (req, res) => {
  const label = await store.findOne("qr_labels", { _id: req.params.id });
  if (!label) return res.status(404).json({ error: "Label not found." });

  const cleanupWarnings = await cleanupLabelArtifacts([label]);

  await store.delete("qr_labels", req.params.id);
  await store.deleteMany("certificates", { certificateId: label.certificateId });

  const remainingBatchLabels = label.batchId
    ? await store.list("qr_labels", { batchId: label.batchId })
    : [];
  if (label.batchId && remainingBatchLabels.length === 0) {
    const batch = await store.findOne("qr_batches", { batchId: label.batchId });
    if (batch) await store.delete("qr_batches", batch._id);
  }

  res.json({
    deleted: true,
    certificateId: label.certificateId,
    catalogueNumber: label.catalogueNumber,
    lotNumber: label.lotNumber,
    serialNumber: label.serialNumber,
    cleanupWarnings: cleanupWarnings.length
  });
}));

app.delete("/api/qr-batches/:batchId", asyncRoute(async (req, res) => {
  const batchId = req.params.batchId?.trim();
  const batch = await store.findOne("qr_batches", { batchId });
  if (!batch) return res.status(404).json({ error: "Batch not found." });

  const labels = await store.list("qr_labels", { batchId });
  const cleanupWarnings = await cleanupLabelArtifacts(labels);
  let deletedCertificates = await store.deleteMany("certificates", { batchId });

  for (const label of labels) {
    if (label.certificateId) {
      deletedCertificates += await store.deleteMany("certificates", { certificateId: label.certificateId });
    }
  }

  const deletedLabels = await store.deleteMany("qr_labels", { batchId });
  await store.delete("qr_batches", batch._id);

  res.json({
    deleted: true,
    batchId,
    deletedLabels,
    deletedCertificates,
    cleanupWarnings: cleanupWarnings.length
  });
}));

app.get("/api/certificates/search", asyncRoute(async (req, res) => {
  const certificates = await store.list("certificates");
  const catalogueNumber = normaliseCatalogue(req.query.catalogueNumber || "");
  const lotNumber = req.query.lotNumber?.toString().trim().toUpperCase();
  const serialNumber = req.query.serialNumber ? serialToNumber(req.query.serialNumber) : null;
  const result = certificates.filter((certificate) =>
    (!catalogueNumber || certificate.catalogueNumber === catalogueNumber) &&
    (!lotNumber || certificate.lotNumber === lotNumber) &&
    (!serialNumber || Number(certificate.serialNumber) === serialNumber));
  res.json(result.map((certificate) => ({
    ...certificate,
    _id: String(certificate._id),
    qrLabelId: certificate.qrLabelId ? String(certificate.qrLabelId) : "",
    qrDxfUrl: certificate.qrDxfUrl ||
      `/api/certificates/${encodeURIComponent(certificate.certificateId)}/dxf`
  })));
}));

app.get("/api/catalogue/:certificateId", asyncRoute(async (req, res) => {
  const certificate = await store.findOne("certificates", { certificateId: req.params.certificateId });
  if (!certificate) return res.status(404).json({ error: "Catalogue record not found." });

  const label = await store.findOne("qr_labels", { certificateId: certificate.certificateId });
  const product = await findProductByCatalogue(certificate.catalogueNumber);
  const data = certificate.certificateData || {};

  res.json({
    certificateId: certificate.certificateId,
    catalogueNumber: certificate.catalogueNumber,
    productName: certificate.productName,
    lotNumber: certificate.lotNumber,
    serialNumber: certificate.serialNumber,
    status: certificate.status,
    catalogueUrl: `${publicBaseUrl(req)}/api/certificates/${encodeURIComponent(certificate.certificateId)}/image.webp`,
    coaUrl: `${publicBaseUrl(req)}/api/certificates/${encodeURIComponent(certificate.certificateId)}/image.webp`,
    pdfUrl: `${publicBaseUrl(req)}/api/certificates/${encodeURIComponent(certificate.certificateId)}/pdf`,
    product: {
      productName: product?.productName || certificate.productName || "",
      productType: product?.productType || data.productType || "",
      category: product?.category || data.category || "",
      catalogueNumber: product?.catalogueNumber || certificate.catalogueNumber || "",
      company: product?.company || data.company || "Omsons Germany",
      membrane: product?.membrane || data.membrane || "",
      poreSize: product?.poreSize || data.poreSize || "",
      technicalDetail: product?.technicalDetail || data.gtap || "",
      sterilityType: product?.sterilityType || data.sterilityType || "",
      housing: product?.housing || data.housing || "",
      filterDiameter: product?.filterDiameter || data.filterDiameter || "",
      burstPressure: product?.burstPressure || data.burstPressure || "",
      holdupVolume: product?.holdupVolume || data.holdupVolume || "",
      sterilizationMethod: product?.sterilizationMethod || data.sterilizationMethod || "",
      packSize: product?.packSize || data.packSize || "",
      hsnCode: product?.hsnCode || data.hsnCode || "",
      labelTemplate: product?.labelTemplate || "",
      certificateTemplate: product?.certificateTemplate || data.certificateTemplate || ""
    },
    lot: {
      lotNumber: certificate.lotNumber,
      serialNumber: certificate.serialNumber,
      manufacturingDate: data.manufacturingDate || "",
      expiryDate: data.expiryDate || "",
      lotBreakdown: data.lotBreakdown || null
    },
    qr: {
      url: label?.qrUrl || "",
      image: label?.qrImagePath || "",
      imageCloudinaryUrl: label?.qrImageCloudinaryUrl || "",
      dxfUrl: label?.qrDxfUrl || certificate.qrDxfUrl ||
        `/api/certificates/${encodeURIComponent(certificate.certificateId)}/dxf`
    }
  });
}));

app.get("/api/certificates/:certificateId/dxf", asyncRoute(async (req, res) => {
  const certificate = await store.findOne("certificates", { certificateId: req.params.certificateId });
  if (!certificate) return res.status(404).json({ error: "Certificate not found." });

  const label = await store.findOne("qr_labels", { certificateId: certificate.certificateId });
  const qrUrl = label?.qrUrl || certificate.verificationUrl ||
    `${publicBaseUrl(req)}/coa/${encodeURIComponent(certificate.certificateId)}`;
  const dxf = buildQrDxf({ certificateId: certificate.certificateId, qrUrl });
  const fileName = `${safeCertificateFileName(certificate.certificateId)}.dxf`;

  res.set("Content-Type", "image/vnd.dxf");
  res.set("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(dxf);
}));

app.get("/api/certificates/:certificateId/pdf", asyncRoute(async (req, res) => {
  const certificate = await store.findOne("certificates", { certificateId: req.params.certificateId });
  if (!certificate) return res.status(404).json({ error: "Certificate not found." });

  const pdfPath = await renderCertificatePdf(certificate);
  const fileName = `${safeCertificateFileName(certificate.certificateId)}.pdf`;
  res.download(pdfPath, fileName);
}));

app.get("/api/certificates/:certificateId/image.:format", asyncRoute(async (req, res) => {
  const format = req.params.format?.toLowerCase();
  if (!["webp", "jpg", "jpeg"].includes(format)) {
    return res.status(400).json({ error: "Use webp, jpg, or jpeg." });
  }

  const certificate = await store.findOne("certificates", { certificateId: req.params.certificateId });
  if (!certificate) return res.status(404).json({ error: "Certificate not found." });

  const image = await ensureCertificateImage(certificate);
  res.set("Cache-Control", "public, max-age=300");
  res.redirect(302, certificateDeliveryUrl(image.secureUrl, format));
}));

app.get("/api/certificates/:certificateId", asyncRoute(async (req, res) => {
  const certificate = await store.findOne("certificates", { certificateId: req.params.certificateId });
  if (!certificate) return res.status(404).json({ error: "Certificate not found." });
  res.json(certificate);
}));

app.get("/catalogue/:certificateId", (req, res) => {
  res.redirect(302, `/coa/${encodeURIComponent(req.params.certificateId)}`);
});

app.get("/coa/:certificateId", (req, res) => {
  res.redirect(302, `/api/certificates/${encodeURIComponent(req.params.certificateId)}/image.webp`);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Unexpected server error." });
});

function startServer() {
  const server = app.listen(port, () => {
    console.log(`Omsons QR label app running on port ${port}`);
  });

  initialiseStore()
    .then(() => console.log(`Storage ready: ${store instanceof MongoStore ? "mongodb" : "json"}`))
    .catch((error) => {
      console.error("Initial storage connection failed; the app will retry:", storageErrorSummary(error));
    });

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      if (store instanceof MongoStore && store.client) {
        await store.client.close();
      }
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

if (require.main === module) startServer();

module.exports = app;
module.exports.buildQrDxf = buildQrDxf;
module.exports.buildCertificateSvg = buildCertificateSvg;
module.exports.certificateDeliveryUrl = certificateDeliveryUrl;
module.exports.initialiseStore = initialiseStore;
module.exports.startServer = startServer;




