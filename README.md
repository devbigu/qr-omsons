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

## Shared Login

The admin UI, static admin assets, downloads, lot viewer, and all management APIs require the shared administrator login. QR scans remain public and open the WebP certificate directly.

Before starting the app, set:

- `ADMIN_USERNAME` (matching is case-insensitive)
- `ADMIN_PASSWORD_HASH` (bcrypt only; never store the plaintext password)
- `SESSION_SECRET` (a long random value)
- `SESSION_TTL_DAYS=7` (optional; defaults to 7)

Generate the password hash and session secret locally:

```sh
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" "replace-with-password"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

MongoDB deployments store sessions in the `sessions` collection so logins survive restarts. JSON/local mode uses the in-memory session store and is intended for one development process.

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
- `ADMIN_USERNAME`, the shared case-insensitive login name
- `ADMIN_PASSWORD_HASH`, a bcrypt password hash
- `SESSION_SECRET`, required in production
- `SESSION_TTL_DAYS=7`, optional session lifetime
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
Node hosts. The catch-all route in `vercel.json` sends static admin assets through
Express so the login middleware cannot be bypassed. Configure the same environment
variables in the Vercel project and deploy from the repository root.

## Docker Deploy

Build and run the included container:

```sh
docker build -t omsons-qr-labels .
docker run -p 3000:3000 \
  -e PUBLIC_BASE_URL=http://localhost:3000 \
  -e MONGODB_URI= \
  -e ADMIN_USERNAME=admin@example.com \
  -e ADMIN_PASSWORD_HASH='<bcrypt-hash>' \
  -e SESSION_SECRET='<long-random-secret>' \
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
- The admin UI and lot URLs require the shared login. Public QR scans expose only the certificate-image route.
- Login rate limiting is not implemented yet; add it before exposing the login endpoint to sustained hostile traffic.
