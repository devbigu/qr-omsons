# Omsons QR Labels - Application Context

Last updated: 2026-06-28

## Purpose

This is an Omsons product-label and Certificate of Quality (COA) system. Operators maintain products, generate lot-based serialized labels, print/reprint batches, download QR assets, view all labels in a lot, and delete incorrect records.

Each generated label has:

- Product, catalogue, lot, and serial data
- A unique certificate ID
- A QR PNG
- A JPG conversion route
- A CAD-compatible ASCII DXF
- A certificate snapshot
- A public QR destination that opens the WebP certificate directly

## Stack

- Node.js 18+
- Express 4
- Plain HTML/CSS/browser JavaScript
- MongoDB in production or JSON-file fallback locally
- Cloudinary for QR/certificate assets and image transformations
- `qrcode` for QR generation
- `sharp` for PNG-to-JPG conversion
- `archiver` for streaming ZIP output
- Python 3 and PyMuPDF for certificate PDF rendering
- Node's built-in test runner

There is no frontend framework, bundler, TypeScript, ORM, authentication, or authorization layer.

## Repository Map

| Path | Purpose |
| --- | --- |
| `server.js` | Express server, storage adapters, QR/DXF/image/PDF logic, API routes |
| `public/index.html` | Admin UI markup |
| `public/app.js` | Admin state, rendering, downloads, lot viewer, history handling |
| `public/styles.css` | Admin, labels, menus, certificate, and print styling |
| `data/store.json` | Local JSON database |
| `data/templates/` | Sterile/non-sterile PNGs and source certificate PDF |
| `scripts/render_certificate_pdf.py` | PyMuPDF PDF renderer |
| `test/` | API, deletion, certificate, DXF, frontend, and ZIP tests |
| `.env.example` | Runtime variables |
| `Dockerfile` | Node/Python production container |

## Data Collections

The JSON and MongoDB adapters expose the same collections:

- `products`: product master and lot rules
- `lots`: manufacturing/expiry data and generated lot breakdown
- `qr_batches`: contiguous serial ranges, capped at 300 labels
- `qr_labels`: one physical label and its QR/DXF asset references
- `certificates`: immutable-ish certificate snapshot for a label

MongoDB creates unique indexes for product catalogue numbers and for the label tuple `catalogueNumber + lotNumber + serialNumber`.

No schema changes are required for QR menus, ZIP exports, or the lot viewer.

## Identifiers

Certificate ID:

```text
CERT-{catalogue prefix}-{lot number}-{serial}
```

Default lot rule:

```text
{prefix}{productCode}{two-digit day}{month letter}
```

Example: prefix `S`, product code `55`, day `27`, June `F` -> `S5527F`.

## Generation Flow

`POST /api/qr-batches/generate`:

1. Loads the product.
2. Suggests or accepts a lot number.
3. Validates positive serials and the 300-label limit.
4. Creates the lot if missing.
5. Rejects duplicate catalogue/lot/serial combinations.
6. Creates a batch.
7. For each serial, builds a certificate ID.
8. Encodes the direct WebP certificate URL in the QR.
9. Generates PNG and 25 mm ASCII DXF.
10. Uploads assets to Cloudinary when configured.
11. Inserts label and certificate records.

Generation is sequential and is not wrapped in a transaction. A mid-batch external failure can leave partial records/assets.

## QR Asset Downloads

Per-certificate route family:

- `GET /api/certificates/:certificateId/qr.png`
- `GET /api/certificates/:certificateId/qr.jpg`
- `GET /api/certificates/:certificateId/dxf`

Filenames use:

```text
<catalogueNumber>_<lotNumber>_<serial>.<format>
```

PNG behavior:

- Redirects to the stored Cloudinary PNG when available.
- Otherwise streams a stored data URL or filesystem PNG.

JPG behavior:

- Redirects through the Cloudinary `f_jpg,q_auto:good` transformation when possible.
- Otherwise converts the stored PNG in memory with Sharp and streams JPEG.

DXF is regenerated from the stored QR destination and returned as ASCII AutoCAD R12-style geometry.

## ZIP Export

`GET /api/qr-labels/zip` supports the same filters as the label list:

- `catalogueNumber`
- `lotNumber`
- `batchId`
- optional `format=png|jpg` (default PNG)

At least `lotNumber` or `batchId` is required.

Batch filename:

```text
<catalogue>_<lot>_<startSerial>-<endSerial>.zip
```

Lot filename:

```text
<catalogue>_<lot>_all.zip
```

The ZIP is streamed with Archiver. It buffers only the image currently being appended and writes no temporary files. Reprint and ZIP export read existing records/assets and never regenerate labels.

## Lot-Wise Viewer

The existing COA Records screen is also the lot viewer. Selecting any lot number:

1. Opens COA Records.
2. Filters by that lot.
3. Shows labels across every batch sharing the lot number.
4. Enables a lot-wide ZIP download.
5. Updates browser history to `/?id=qr-<lotNumber>`.

Opening that URL directly preloads the same lot view without another click. The current origin is used; no deployment domain is hardcoded.

## Download Menu UI

Every label card and COA Records row uses the same three-dot overflow-menu renderer. The global floating menu contains:

- Download PNG
- Download JPG
- Download DXF

Only one menu can be open. It closes on outside click, Escape, resize, or scroll. A global fixed-position popover avoids clipping inside scrollable tables.

Label Preview includes `Download All (.zip)` for the active batch. COA Records includes the same action when a lot filter is active.

## Certificate Delivery

New QR codes point directly to:

```text
/api/certificates/:certificateId/image.webp
```

Legacy `/coa/:certificateId` links redirect there. On first image request, the server builds an SVG over the sterile or non-sterile PNG template, uploads it to Cloudinary, stores its public ID/URL, and redirects to the WebP transform.

Certificate PDFs use the two-page source PDF and `scripts/render_certificate_pdf.py`. Page 1 is sterile and page 2 is non-sterile.

## Deletion

Deleting a label or batch removes:

- QR PNG from Cloudinary
- DXF raw asset from Cloudinary
- Generated certificate image from Cloudinary
- Local generated certificate JSON/PDF
- Certificate and label records
- Empty batch record

Download and ZIP routes create no persistent assets, so deletion cleanup is unchanged.

## Main API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Storage/Cloudinary health |
| GET | `/api/dashboard` | Counts and recent labels |
| CRUD | `/api/products...` | Product master |
| GET/POST | `/api/lots...` | Lots and suggestions |
| GET | `/api/qr-batches` | Saved batches |
| POST | `/api/qr-batches/generate` | Generate labels/certificates/assets |
| GET | `/api/qr-labels` | Filter labels |
| GET | `/api/qr-labels/zip` | Stream batch/lot ZIP |
| DELETE | `/api/qr-labels/:id` | Delete one label |
| DELETE | `/api/qr-batches/:batchId` | Delete one batch |
| GET | `/api/certificates/search` | Search COA records |
| GET | `/api/certificates/:id/qr.png` | QR PNG |
| GET | `/api/certificates/:id/qr.jpg` | QR JPG |
| GET | `/api/certificates/:id/dxf` | QR DXF |
| GET | `/api/certificates/:id/image.webp` | WebP certificate |
| GET | `/api/certificates/:id/image.jpg` | JPEG certificate |
| GET | `/api/certificates/:id/pdf` | Certificate PDF |
| GET | `/coa/:id` | Legacy redirect to WebP |

## Storage

JSON mode is selected with `STORAGE_MODE=json` or when `MONGODB_URI` is absent. It rewrites the complete `DATA_DIR/store.json` file and is not safe for concurrent multi-instance production.

MongoDB is selected when `MONGODB_URI` is present. It is the recommended production store.

## Environment

Important variables:

- `PORT`
- `PUBLIC_BASE_URL`
- `TRUST_PROXY`
- `STORAGE_MODE`
- `DATA_DIR`
- `MONGODB_URI`, `MONGODB_DB`
- MongoDB timeout/pool variables
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER`
- `PYTHON`
- `CERTIFICATE_TEMPLATE_FILE`

`PUBLIC_BASE_URL` must be correct before generation because it is encoded in QR PNG/DXF output.

## Commands

```bash
npm install
npm run check
npm test
npm start
```

## Invariants

- Catalogue numbers are uppercase and unique.
- Catalogue/lot/serial is unique.
- Batches contain at most 300 labels.
- Reprint never creates duplicate assets.
- QR scanning opens WebP directly.
- Vector downloads are DXF, never the old DXL payload.
- ZIP exports only read existing assets and leave no temp files.
- Legacy `/coa` and legacy DXL public IDs remain compatible for old records.

## Security Warning

The application has no authentication. The admin UI, search routes, download routes, and shareable lot URLs are public when the deployment is public. Anyone with `/?id=qr-<lotNumber>` can view and download every label in that lot. This is existing architecture, not solved by the QR download feature, and must be considered before sharing URLs externally.

## Known Limitations

- Batch generation is not transactional.
- JSON mode has no locking or concurrency protection.
- WebP certificate delivery requires Cloudinary.
- List/search endpoints are not paginated.
- Fixed template coordinates must be recalibrated when certificate assets change.
- No auth, CSRF protection, rate limiting, audit identity, or background queue.
- Old `coa.html/coa.js` and catalogue files remain but public routes now use direct WebP.
- Legacy records may retain `qrDxl*` fields; current generation and downloads use `qrDxf*`.