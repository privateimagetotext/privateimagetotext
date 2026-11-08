"""One source-justified bounded page failure candidate; no browser execution.

The first two bytes pass PDF.js's FlateStream constructor; the reserved block
type fails deferred decompression. Both Page dictionaries and page 2 are valid.
"""
from __future__ import annotations

import hashlib
import io
import json
import subprocess
import zlib
from pathlib import Path

import pypdf
import reportlab
from pypdf import PdfReader
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp/pdf-native-page-failure-20260906"
PDF = OUT / "deferred-flate-page-error.pdf"
MANIFEST = ROOT / "tools/pdf-release/native-page-failure.json"
SENTINEL = "SECOND PAGE REMAINS READABLE 86420"
MALFORMED_STREAM = bytes.fromhex("789c0700000001")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stream(data, extra=b""):
    return b"<< /Length " + str(len(data)).encode() + b" " + extra + b" >>\nstream\n" + data + b"\nendstream"


def build(objects):
    data = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number, value in sorted(objects.items()):
        offsets[number] = len(data)
        data.extend(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(data)
    data.extend(b"xref\n0 8\n0000000000 65535 f \n")
    for number in range(1, 8):
        data.extend(f"{offsets[number]:010d} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    result = bytes(data)
    for number, offset in offsets.items():
        assert result[offset:].startswith(f"{number} 0 obj\n".encode())
    return result, offsets, xref


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Valid CMF/FLG, compression method 8, no dictionary, correct FCHECK.
    cmf, flg, block = MALFORMED_STREAM[:3]
    assert cmf & 0x0f == 8 and ((cmf << 8) + flg) % 31 == 0 and not flg & 0x20
    assert block & 1 == 1 and (block >> 1) & 3 == 3  # final, reserved BTYPE
    try:
        zlib.decompress(MALFORMED_STREAM)
        raise AssertionError("Reserved DEFLATE block must reject")
    except zlib.error as error:
        independent_error = str(error)
        assert "invalid block type" in independent_error

    buffer = io.BytesIO()
    document = canvas.Canvas(buffer, pagesize=(612, 792), invariant=1, pageCompression=0)
    document.setFont("Helvetica", 18)
    document.drawString(36, 680, SENTINEL)
    document.setFont("Helvetica", 14)
    document.drawString(36, 640, "This separate page has a complete, valid text stream.")
    document.drawString(36, 614, "Its contents must survive the first page's decoding error.")
    document.showPage()
    document.save()
    second_content = PdfReader(buffer).pages[0].get_contents().get_data()
    objects = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Count 2 /Kids [4 0 R 6 0 R] >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        4: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents [5 0 R] >>",
        5: stream(MALFORMED_STREAM, b"/Filter /FlateDecode"),
        6: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>",
        7: stream(second_content),
    }
    pdf_bytes, offsets, xref = build(objects)
    assert len(pdf_bytes) < 4096 and len(second_content) < 1024
    parsed = PdfReader(io.BytesIO(pdf_bytes), strict=True)
    assert len(parsed.pages) == 2
    assert all(page["/Type"] == "/Page" for page in parsed.pages)
    assert parsed.pages[0]["/Contents"][0].get_object()._data == MALFORMED_STREAM
    assert parsed.pages[0]["/Contents"][0].get_object()["/Filter"] == "/FlateDecode"
    second_text = parsed.pages[1].extract_text()
    assert SENTINEL in second_text
    assert parsed.pages[1].get_contents().get_data() == second_content
    if PDF.exists() and PDF.read_bytes() != pdf_bytes:
        raise RuntimeError("Refusing to overwrite different existing candidate")
    PDF.write_bytes(pdf_bytes)
    poppler = subprocess.run(["pdfinfo", str(PDF)], capture_output=True, text=True, timeout=15)
    assert poppler.returncode == 0 and poppler.stderr == ""
    pdfjs_package = json.loads((ROOT / "node_modules/pdfjs-dist/package.json").read_text(encoding="utf-8"))
    assert pdfjs_package["version"] == "6.2.108"
    expected = {
        "outcomes": ["page failed and processing continued"],
        "mode": "embedded-text-only", "selectedPages": [1, 2], "pageCount": 2,
        "requiredText": [{"page": 2, "text": SENTINEL}, {"page": 2, "text": "This separate page has a complete, valid text stream."}],
        "forbiddenText": [], "failedPages": [1],
        "safeErrorCodes": ["PDF_PAGE_TEXT_EXTRACTION_FAILED"],
        "warningCodes": [], "emptyPages": [], "requiresRender": False,
    }
    manifest = {
        "schemaVersion": 1, "createdAt": "2026-09-06",
        "scope": "One independently justified candidate for native isolated-page failure and later-page extraction; no browser outcome asserted.",
        "fixtures": [{
            "id": "deferred-flate-page-error", "category": "native-page-failure-continuation",
            "availability": "available", "file": PDF.relative_to(ROOT).as_posix(),
            "bytes": len(pdf_bytes), "sha256": sha(pdf_bytes), "expected": expected,
            "structureAssertions": [
                "Two valid independent Page dictionaries and exact ordinary xref offsets; page1 Contents array refers to a7-byte Flate stream; page2 has a separate valid uncompressed content stream.",
                "Flate bytes789c0700000001 have valid CMF/FLG, no preset dictionary, and reserved DEFLATE BTYPE3 after the header; independent zlib rejects invalid block type.",
                "Pinned PDF.js6.2.108 FlateStream constructor accepts this header; reserved block failure occurs during deferred decompression/readBlock outside makeFilter's constructor-to-NullStream recovery.",
                "pypdf strict reader sees both pages and extracts the required page2 text; Poppler pdfinfo sees2pages without syntax warnings.",
            ],
            "notes": [
                "Synthetic harmless public sentinel only. No active content, attachments, external reference, encryption, cyclic tree, oversized page or compression pressure.",
                "Native proof must use real PDF.js and the existing app with stopAtErrors=true, show page1 fixed safe error, page2 full sentinel text, and cleanup. No parse-result injection or expectation rewriting.",
                "Original corrupt-header and malformed-hybrid fixtures/contracts remain unchanged. This is a different source-justified deferred-decompression failure.",
            ],
        }], "untestedCategories": [],
    }
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode()
    if MANIFEST.exists() and MANIFEST.read_bytes() != manifest_bytes:
        raise RuntimeError("Refusing to rewrite a frozen candidate contract")
    MANIFEST.write_bytes(manifest_bytes)
    evidence = {
        "pdfSha256": sha(pdf_bytes), "manifestSha256": sha(manifest_bytes),
        "generatorSha256": sha(Path(__file__).read_bytes()), "bytes": len(pdf_bytes),
        "pdfjsVersion": pdfjs_package["version"],
        "installedWorkerSha256": sha((ROOT / "node_modules/pdfjs-dist/build/pdf.worker.mjs").read_bytes()),
        "libraries": {"pypdf": pypdf.__version__, "reportlab": reportlab.Version},
        "headerHex": MALFORMED_STREAM[:2].hex(), "blockByteHex": f"{block:02x}",
        "reservedDeflateBlockType": (block >> 1) & 3,
        "malformedStreamBytes": len(MALFORMED_STREAM), "independentZlibError": independent_error,
        "xrefOffset": xref, "objectOffsets": offsets, "pageCount": len(parsed.pages),
        "page2Characters": len(second_text), "page2TextSha256": sha(second_text.encode()),
        "page2Text": second_text, "page2StreamBytes": len(second_content),
        "pdfinfo": {"exitCode": poppler.returncode, "stdout": poppler.stdout, "stderr": poppler.stderr},
        "sourceBasis": {
            "oldHeaderRecovery": "pdf.worker.mjs:11786 makeFilter catches constructor error and returns NullStream",
            "constructorChecks": "pdf.worker.mjs:9880 FlateStream validates only zlib header here",
            "deferredFailure": "pdf.worker.mjs:10106 readBlock throws for reserved block type",
            "arrayPropagation": "pdf.worker.mjs:3906 StreamsSequenceStream and59112 Page.#onSubStreamError rethrow when ignoreErrors=false",
            "textFailurePropagation": "pdf.worker.mjs:36486 getTextContent rethrows when ignoreErrors=false",
            "appConfiguration": "src/features/pdf/pdfjs-adapter.ts:267 stopAtErrors:true",
        },
    }
    (OUT / "independent-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"id": "deferred-flate-page-error", "pdfSha256": sha(pdf_bytes), "bytes": len(pdf_bytes), "manifestSha256": sha(manifest_bytes), "page2Characters": len(second_text)}))


if __name__ == "__main__":
    main()
