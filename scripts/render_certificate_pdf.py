import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".agents" / "pymupdf"))

import fitz

INK = (0.102, 0.101, 0.095)
WHITE = (1, 1, 1)


def is_sterile(value):
    value = (value or "").strip().lower().replace("-", " ")
    return bool(value) and value != "non sterile"


def fmt_date(value):
    if not value:
        return ""
    try:
        from datetime import datetime
        normalized = value.replace("Z", "+00:00")
        date = datetime.fromisoformat(normalized)
        return date.strftime("%d/%m/%Y")
    except Exception:
        return value


def clean(value):
    return "" if value is None else str(value)


def write(page, x, y, value, size=12, max_chars=44):
    text = clean(value).strip()
    if not text:
        return
    if len(text) > max_chars:
        text = text[: max_chars - 1] + "..."
    page.insert_text((x, y), text, fontsize=size, fontname="helv", color=INK, overlay=True)


def cover(page, rect):
    page.draw_rect(fitz.Rect(*rect), color=None, fill=WHITE, overlay=True)


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: render_certificate_pdf.py payload.json template.pdf output.pdf")

    payload_path = Path(sys.argv[1])
    template_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    data = payload.get("certificateData") or {}
    sterile = is_sterile(data.get("sterilityType"))
    page_index = 0 if sterile else 1

    doc = fitz.open(template_path)
    doc.select([page_index])
    page = doc[0]

    product_status = "Sterile" if sterile else "Non-Sterile"
    product_membrane = data.get("membrane") or payload.get("productName") or "Nylon"
    product_line = f"Product : {product_membrane}, Syringe Filters, {product_status}"

    # Replace the fixed product line in the template, then fill the blank fields.
    cover(page, (58, 132, 382, 158))
    write(page, 64, 154, product_line, size=16, max_chars=56)

    left_x = 150
    right_x = 405
    write(page, left_x, 182, data.get("company") or "Omsons", max_chars=28)
    write(page, left_x, 202, data.get("poreSize"), max_chars=28)
    write(page, left_x, 221, payload.get("catalogueNumber"), max_chars=32)
    write(page, left_x, 241, payload.get("lotNumber"), max_chars=28)

    if sterile:
        write(page, left_x, 260, fmt_date(data.get("expiryDate")), max_chars=24)
        write(page, left_x, 280, data.get("sterilizationMethod") or data.get("sterilityType") or "Sterile", max_chars=30)

    write(page, right_x, 182, data.get("membrane"), max_chars=28)
    write(page, right_x, 202, data.get("housing"), max_chars=28)
    write(page, right_x, 221, data.get("filterDiameter"), max_chars=28)
    write(page, right_x, 241, data.get("burstPressure"), max_chars=28)
    write(page, right_x, 260, data.get("holdupVolume"), max_chars=28)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()


if __name__ == "__main__":
    main()
