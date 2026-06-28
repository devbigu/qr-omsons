# Omsons QR Labels

Operator instructions, including bulk generation and reprinting: [USER_MANUAL.md](USER_MANUAL.md)

Express app for generating Omsons QR labels and public COA verification pages.

See [APP_CONTEXT.md](APP_CONTEXT.md) for the complete architecture, data model, API, workflows, deployment notes, and known limitations.

## Operator Workflow

1. Save the product once in **Product Master**, including its catalogue number, membrane, pore size, and lot product code.
2. Open **Generate Labels** and select the product.
3. Choose the manufacturing date. The lot is generated as `S + product code + day + month letter`; for product code `55` on 16 May, the result is `S5516E`.
4. Enter the starting and ending serial numbers, then generate.
5. Print or save the fixed label sheet. Saved batches can be reopened with **Reprint** without regenerating QR assets.

Each QR opens its WebP certificate image directly, without a format chooser or print prompt. Generation uploads the DXF asset first and the scannable PNG image second, then stores their Cloudinary URLs with the label record.

## QR Downloads and Lot Viewer

- Every label exposes one overflow menu with PNG, JPG, and DXF downloads.
- `GET /api/certificates/:certificateId/qr.png` returns the stored QR PNG.
- `GET /api/certificates/:certificateId/qr.jpg` redirects through Cloudinary when available or converts PNG to JPG with Sharp.
- `GET /api/qr-labels/zip?batchId=...` streams all QR images for one batch.
- `GET /api/qr-labels/zip?lotNumber=...` streams labels across every batch in the lot.
- Opening `/?id=qr-<lotNumber>` loads the lot-wise COA Records view directly.

## Requirements

- Node.js 18 or newer
- Python 3.10 or newer for certificate PDF rendering
- MongoDB for production persistence, recommended

## Local Setup

```sh
npm install
pip install -r requirements.txt
cp .env.example .env
npm run check
npm start
```

Open `http://localhost:3000` and verify `http://localhost:3000/api/health` returns `ok: true`.

## Production Environment

Set these variables on your host:

- `NODE_ENV=production`
- `PORT` from the platform, or `3000`
- `PUBLIC_BASE_URL=https://your-domain.example`, required for QR codes to point at the deployed site
- `MONGODB_URI`, recommended so labels and certificates persist across deploys
- `MONGODB_DB=omsons_qr`, optional
- `MONGODB_FAMILY=4`, recommended on managed hosts to avoid IPv6 connection issues
- `MONGODB_CONNECT_TIMEOUT_MS=10000` and `MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000`, optional
- `STORAGE_MODE=json`, optional local fallback override; do not use for production persistence
- `DATA_DIR`, optional writable directory for JSON fallback storage and generated PDFs
- `PYTHON=python3`, or the platform's Python path
- `CERTIFICATE_TEMPLATE_FILE`, optional override for the source certificate template PDF
- `TRUST_PROXY=true` when running behind a managed HTTPS proxy
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to upload generated QR assets
- `CLOUDINARY_FOLDER=omsons-qr-labels`, optional Cloudinary folder for uploaded QR files

If `MONGODB_URI` is not set, the app stores data in `DATA_DIR/store.json`. That is fine for a demo, but most hosts erase local files on redeploy.

## Node Host Deploy

Use these commands on Render, Railway, Fly, a VPS, or a similar Node host:

```sh
npm ci --omit=dev
pip install -r requirements.txt
npm run check
npm start
```

Health check path: `/api/health`.

The process starts before the first database connection finishes and retries a failed
MongoDB connection. `/api/health` returns HTTP 503 until storage is ready instead of
crashing and restarting the entire service.

## Vercel Deploy

`server.js` exports Express for Vercel while still starting a normal port listener on
Node hosts. Vercel serves files from `public/` through its CDN. Configure the same
environment variables in the Vercel project and deploy from the repository root.

## Docker Deploy

Build and run the included container:

```sh
docker build -t omsons-qr-labels .
docker run -p 3000:3000 \
  -e PUBLIC_BASE_URL=http://localhost:3000 \
  -e MONGODB_URI= \
  omsons-qr-labels
```

For production, pass a real `PUBLIC_BASE_URL` and `MONGODB_URI`.

## Notes

- QR generation creates a 25 mm ASCII `.dxf` drawing first, uploads it to Cloudinary as a raw asset, then uploads the display PNG image.
- Deleting a label also removes its PNG/DXF Cloudinary assets and removes an empty batch.
- Generated certificate PDFs are written under `DATA_DIR/certificates` and are intentionally ignored by git.
- The public COA route `/coa/:certificateId` redirects directly to the WebP certificate image for compatibility with existing labels.
- Certificate images are generated lazily from the official template and delivered through Cloudinary as WebP or JPEG.
- The PDF template lives at `data/templates/syringe-filter-certificate.pdf`.
- ZIP archives are streamed with Archiver and do not create temporary files.
- **Security:** there is no authentication. Anyone with a shareable `?id=qr-<lotNumber>` URL can view and download that lot's labels.
