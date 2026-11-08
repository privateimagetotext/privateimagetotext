"""Wrap one unchanged, attributed public CORD image in a one-page PDF."""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tmp/pdf-cord-receipt-20260906/cord-train-9.jpg"
OUT = ROOT / "tmp/pdf-diversity-20260906/receipt"
EXPECTED = "9d7b06c4cf079749b7e8a650d63aecf99522e114900c3e0bc1a263812be79179"
data = SOURCE.read_bytes()
assert hashlib.sha256(data).hexdigest() == EXPECTED
assert Image.open(SOURCE).size == (864, 1296)
filename = OUT / "cord-train-9-receipt.pdf"
if sys.argv[1:] == ["--verify-existing"]:
    assert filename.is_file() and not (OUT / "manifest.json").exists()
else:
    assert len(sys.argv) == 1
    OUT.mkdir(exist_ok=False)
    document = canvas.Canvas(str(filename), pagesize=(432, 648), pageCompression=1, invariant=1)
    document.setTitle("CORD v2 train row 9: public receipt image")
    document.setAuthor("CORD dataset authors; PDF wrapper created for LocalOCR validation")
    document.setSubject("Unmodified CORD v2 train row9 JPEG. CC BY 4.0. https://huggingface.co/datasets/naver-clova-ix/cord-v2 ; https://github.com/clovaai/cord . Wrapper scales image geometrically to 144 source pixels per inch; no pixel edits or added text layer. Not an original scanner/mobile-app PDF.")
    document.drawImage(str(SOURCE), 0, 0, width=432, height=648, preserveAspectRatio=True)
    document.showPage()
    document.save()
reader = PdfReader(filename)
assert len(reader.pages) == 1 and reader.pages[0].extract_text() == ""
images = [obj.get_object() for obj in reader.pages[0]["/Resources"]["/XObject"].values()]
assert len(images) == 1 and images[0]["/Subtype"] == "/Image"
# pypdf's high-level page.images export may rewrite JPEG metadata. Inspect the
# actual XObject bytes after ASCII85 decoding, retaining the original DCT data.
assert hashlib.sha256(images[0].get_data()).hexdigest() == EXPECTED, "JPEG stream must survive the PDF wrapper unchanged"
pdf = filename.read_bytes()
record = {
    "id": "cord-train-9-receipt", "sourceImagePath": SOURCE.relative_to(ROOT).as_posix(),
    "sourceImageBytes": len(data), "sourceImageSha256": EXPECTED,
    "sourceSize": [864, 1296], "pdfPageSizePoints": [432, 648], "sourcePixelsPerInch": 144,
    "pdfPath": filename.relative_to(ROOT).as_posix(), "pdfBytes": len(pdf), "pdfSha256": hashlib.sha256(pdf).hexdigest(),
    "imageStreamUnchanged": True, "embeddedTextCharacters": 0,
    "licence": "CC BY 4.0", "attribution": "Park et al., CORD: A Consolidated Receipt Dataset for Post-OCR Parsing (2019); naver-clova-ix/cord-v2 train row9",
    "sourceUrl": "https://huggingface.co/datasets/naver-clova-ix/cord-v2", "licenceSource": "https://github.com/clovaai/cord",
    "review": "Full original JPEG visually reviewed by two agents before wrapping; public image has pre-existing blurred header/footer fields, and no legible personal or sensitive content was detected. Source image was not modified.",
    "scope": "Real receipt photograph in an authored PDF wrapper; does not establish original printer/mobile scanning-app PDF provenance.",
}
(OUT / "manifest.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(record))
