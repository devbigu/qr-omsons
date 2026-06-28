# Omsons QR Label Generator - User Manual

## 1. Open the Software

Open the application URL provided by your administrator. For local use:

`http://localhost:3000`

The left menu contains Dashboard, Products, Generate Labels, Label Preview, and COA Records.

## 2. Add a Product

Products only need to be entered once.

1. Open **Products**.
2. Enter the product name and catalogue number.
3. Enter the membrane and pore size shown on the label.
4. Enter the lot prefix, normally `S`.
5. Enter the product's lot code, for example `55`.
6. Confirm the month codes are `A,B,C,D,E,F,G,H,I,J,K,L`.
7. Select **Save Product**.

The catalogue number must be unique. Saved product details are fetched automatically during label generation.

## 3. Generate One Label

1. Open **Generate Labels**.
2. Select the product.
3. Select the manufacturing date.
4. Confirm the automatically generated lot number.
5. Enter the same number in **Start serial** and **End serial**.
6. Select **Generate**.

Example: start serial `101` and end serial `101` generates one label.

## 4. Generate Labels in Bulk

1. Open **Generate Labels**.
2. Select the required product.
3. Select the manufacturing date and optional expiry date.
4. Confirm the lot number.
5. Enter the first serial number in **Start serial**.
6. Enter the last serial number in **End serial**.
7. Check the displayed label count.
8. Select **Generate** once and wait for completion.

Example: start serial `101` and end serial `150` creates 50 unique labels numbered `101` through `150`.

Each serial receives its own certificate ID, QR code, Cloudinary PNG image, and DXF file. A maximum of 300 labels can be generated in one batch. Do not close or refresh the page while a bulk batch is being generated.

The software rejects duplicate serial numbers for the same product and lot.

## 5. Lot Number Rule

The default rule is:

`S + product code + day + month letter`

Month letters are January `A` through December `L`.

Example:

- Product code: `55`
- Manufacturing date: 16 May
- May month code: `E`
- Generated lot: `S5516E`

Each product can have a different product code.

## 6. Print or Save Labels

After generation, the software opens **Label Preview**.

1. Check the product, catalogue, lot, serial, and QR details.
2. Select **Print / Save PDF**.
3. Choose the label printer or **Save as PDF** in the system print dialog.
4. Use 100% scale unless the physical label template requires another setting.

Use **Download First Label** when a PNG file of the first label is required.

## 7. Reprint a Batch

1. Open **Label Preview**.
2. Find the batch under **Saved Batches**.
3. Select **Reprint**.
4. Confirm the labels, then select **Print / Save PDF**.

Reprinting reuses the saved QR images and does not create duplicate database or Cloudinary records.

## 8. Scan and Verify a QR Code

1. Scan the QR code with a phone camera.
2. Open the displayed link.
3. Confirm the product, catalogue number, lot, and serial number.
4. The certificate displays as a WebP image; use the toolbar for JPEG or print/PDF output.

The QR destination uses the public application URL configured by the administrator.

## 9. Find a COA Record

1. Open **COA Records**.
2. Search by catalogue number, lot number, serial number, or a combination.
3. Select **Open COA** to view the certificate.
4. The certificate opens as a browser-friendly WebP image. Use **Open JPEG** for JPEG or **Print / Save PDF** to print or save it as PDF.
5. Select **Open DXF** to access the stored DXF file.

## 10. Delete an Incorrect Label

Use **Delete** only for an incorrectly generated label. Deleting removes the label and COA record, releases the serial for regeneration, and removes its PNG/DXF assets from Cloudinary.

## 11. Common Messages

- **Product not found:** Add the product in Product Master or select the correct product.
- **Duplicate serial numbers:** Use a new serial range or remove the incorrect existing labels first.
- **End serial must be equal to or greater than start serial:** Correct the serial range.
- **Generate up to 300 labels per batch:** Divide the work into smaller batches.
- **Cloudinary is partially configured:** Ask the administrator to check all Cloudinary environment variables.

## 12. Bulk Generation Checklist

- Correct product selected
- Manufacturing date confirmed
- Generated lot number checked
- Start and end serials checked
- Label count checked
- Stable internet connection available
- Printer and label stock ready
