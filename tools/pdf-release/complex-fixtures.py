"""Deterministic, bounded synthetic PDFs for local release validation only.

Run with the bundled Python (pypdf 6.10/reportlab 4.4/Pillow 12.3).
No networking, external actions, shared fixture regeneration, or browser execution.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import re
import subprocess
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp/pdf-complex-20260906"
FILES = OUT / "fixtures"
EVIDENCE = OUT / "evidence"
MANIFEST = ROOT / "tools/pdf-release/complex-fixtures.json"
FONT = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
SUPPORTED = "supported"
WARNING = "supported with warning"
FAILED = "page failed and processing continued"
REJECTED = "document rejected safely"
UNSUPPORTED = "intentionally unsupported"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def literal(value: str) -> bytes:
    return ("(" + value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")").encode("ascii")


def content(text: str, size=(612, 792), font_size=22) -> bytes:
    buffer = io.BytesIO()
    document = canvas.Canvas(buffer, pagesize=size, invariant=1, pageCompression=0)
    document.setFont("Helvetica", font_size)
    document.drawString(size[0] * .06, size[1] * .75, text)
    document.showPage()
    document.save()
    return PdfReader(buffer).pages[0].get_contents().get_data()


def stream(data: bytes, extra=b"", declared=None) -> bytes:
    return b"<< /Length " + str(len(data) if declared is None else declared).encode() + b" " + extra + b" >>\nstream\n" + data + b"\nendstream"


def build(objects: dict[int, bytes], extra=b"") -> tuple[bytes, int, dict[int, int]]:
    data = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number, value in sorted(objects.items()):
        offsets[number] = len(data)
        data.extend(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {max(objects) + 1}\n0000000000 65535 f \n".encode())
    for number in range(1, max(objects) + 1):
        data.extend((f"{offsets[number]:010d} 00000 n \n" if number in offsets else "0000000000 00000 f \n").encode())
    data.extend(f"trailer\n<< /Size {max(objects) + 1} /Root 1 0 R ".encode() + extra + f" >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(data), xref, offsets


def pages(contents: list[bytes], sizes=None) -> dict[int, bytes]:
    sizes = sizes or [(612, 792)] * len(contents)
    objects = {1: b"<< /Type /Catalog /Pages 2 0 R >>", 3: FONT}
    kids = []
    for index, (data, size) in enumerate(zip(contents, sizes)):
        page = 4 + index * 2
        kids.append(f"{page} 0 R")
        objects[page] = f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {size[0]} {size[1]}] /Resources << /Font << /F1 3 0 R >> >> /Contents {page + 1} 0 R >>".encode()
        objects[page + 1] = stream(data)
    objects[2] = f"<< /Type /Pages /Count {len(contents)} /Kids [{' '.join(kids)}] >>".encode()
    return objects


def object_stream_pdf(hybrid=False) -> bytes:
    normal = pages([content("OBJECT STREAM SENTINEL 31415")])
    compressed = [4] if hybrid else [1, 2, 3, 4]
    body = bytearray()
    pairs = []
    for number in compressed:
        pairs.append(f"{number} {len(body)}")
        body.extend(normal[number] + b"\n")
    header = (" ".join(pairs) + " ").encode()
    encoded = zlib.compress(header + body, 9)
    objstream = stream(encoded, f"/Type /ObjStm /N {len(compressed)} /First {len(header)} /Filter /FlateDecode".encode())
    data = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in ([1, 2, 3, 5] if hybrid else [5]):
        offsets[number] = len(data)
        data.extend(f"{number} 0 obj\n".encode() + normal[number] + b"\nendobj\n")
    offsets[6] = len(data)
    data.extend(b"6 0 obj\n" + objstream + b"\nendobj\n")
    offsets[7] = len(data)
    entries = []
    for number in ([4] if hybrid else range(8)):
        if number in compressed:
            kind, first, second = 2, 6, compressed.index(number)
        elif number == 0:
            kind, first, second = 0, 0, 65535
        else:
            kind, first, second = 1, offsets[number], 0
        entries.append(bytes([kind]) + first.to_bytes(4, "big") + second.to_bytes(2, "big"))
    metadata = b"/Type /XRef /Size 8 /Root 1 0 R /W [1 4 2]" + (b" /Index [4 1]" if hybrid else b"")
    data.extend(b"7 0 obj\n" + stream(b"".join(entries), metadata) + b"\nendobj\n")
    if hybrid:
        table = len(data)
        data.extend(b"xref\n0 8\n0000000000 65535 f \n")
        for number in range(1, 8):
            data.extend((f"{offsets[number]:010d} 00000 n \n" if number in offsets else "0000000000 00000 f \n").encode())
        data.extend(f"trailer\n<< /Size 8 /Root 1 0 R /XRefStm {offsets[7]} >>\nstartxref\n{table}\n%%EOF\n".encode())
    else:
        data.extend(f"startxref\n{offsets[7]}\n%%EOF\n".encode())
    result = bytes(data)
    assert "OBJECT STREAM SENTINEL 31415" in PdfReader(io.BytesIO(result)).pages[0].extract_text()
    return result


def active_pdf() -> bytes:
    objects = pages([content("ACTIVE CONTENT TEST 12345")])
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R /Names << /EmbeddedFiles << /Names [(synthetic-attachment.txt) 13 0 R] >> /JavaScript << /Names [(harmless-local-sentinel) 14 0 R] >> >> /OpenAction 14 0 R >>"
    objects[4] = objects[4][:-2] + b" /Annots [7 0 R 9 0 R 16 0 R 17 0 R] >>"
    objects[6] = b"<< /Fields [7 0 R 9 0 R] /NeedAppearances false /DA (/F1 16 Tf 0 g) /DR << /Font << /F1 3 0 R >> >> /XFA [(template) 15 0 R] /SigFlags 3 >>"
    objects[7] = b"<< /Type /Annot /Subtype /Widget /FT /Tx /T (syntheticField) /V (VISIBLE FORM VALUE 2048) /Rect [36 480 500 520] /P 4 0 R /AP << /N 8 0 R >> /AA << /U 18 0 R >> >>"
    objects[8] = stream(b"BT /F1 18 Tf 5 12 Td (VISIBLE FORM VALUE 2048) Tj ET", b"/Type /XObject /Subtype /Form /BBox [0 0 464 40] /Resources << /Font << /F1 3 0 R >> >>")
    objects[9] = b"<< /Type /Annot /Subtype /Widget /FT /Sig /T (invalidSignatureMarker) /V 11 0 R /Rect [36 400 550 445] /P 4 0 R /AP << /N 10 0 R >> >>"
    objects[10] = stream(b"BT /F1 16 Tf 5 12 Td (INVALID SIGNATURE TEST MARKER) Tj ET", b"/Type /XObject /Subtype /Form /BBox [0 0 514 45] /Resources << /Font << /F1 3 0 R >> >>")
    objects[11] = b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0 0 0] /Contents <00> /Name (TEST ONLY - NOT A SIGNATURE) /Reason (Intentionally invalid synthetic marker; no trust assertion) >>"
    objects[12] = stream(b"ATTACHMENT_PAYLOAD_SHOULD_NOT_BE_EXTRACTED_1618", b"/Type /EmbeddedFile /Subtype /text#2Fplain")
    objects[13] = b"<< /Type /Filespec /F (synthetic-attachment.txt) /EF << /F 12 0 R >> >>"
    objects[14] = b"<< /S /JavaScript /JS " + literal('app.alert("PDF_JS_SHOULD_NOT_RUN_2718");') + b" >>"
    objects[15] = stream(b'<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"><subform name="SyntheticOnly"><field name="staticField"><value><text>XFA_STATIC_SENTINEL_5772</text></value></field></subform></template>')
    objects[16] = b"<< /Type /Annot /Subtype /Link /Rect [36 300 300 330] /A << /S /URI /URI (about:blank#PDF_LINK_SENTINEL) >> >>"
    objects[17] = b"<< /Type /Annot /Subtype /Link /Rect [36 250 300 280] /A << /S /Launch /F (LOCAL_PDF_TEST_NO_SUCH_FILE.txt) >> >>"
    objects[18] = b"<< /S /SubmitForm /F (about:blank#PDF_FORM_SUBMIT_SENTINEL) /Flags 0 >>"
    result = build(objects)[0]
    reader = PdfReader(io.BytesIO(result))
    fields = reader.get_fields()
    assert set(fields) == {"syntheticField", "invalidSignatureMarker"}
    assert fields["syntheticField"]["/V"] == "VISIBLE FORM VALUE 2048"
    form = reader.trailer["/Root"]["/AcroForm"]
    assert form["/Fields"][0] == reader.pages[0]["/Annots"][0]
    assert b"VISIBLE FORM VALUE 2048" in form["/Fields"][0].get_object()["/AP"]["/N"].get_data()
    assert list(fields["invalidSignatureMarker"]["/V"]["/ByteRange"]) == [0, 0, 0, 0]
    assert b"ATTACHMENT_PAYLOAD_SHOULD_NOT_BE_EXTRACTED_1618" == reader.trailer["/Root"]["/Names"]["/EmbeddedFiles"]["/Names"][1].get_object()["/EF"]["/F"].get_data()
    return result


def image_pdf() -> bytes:
    image = Image.new("L", (720, 150), 255)
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((4, 4, 715, 145), outline=0, width=2)
    drawing.text((18, 52), "RUNLENGTH ASCII85 2468", fill=0, font=ImageFont.load_default(size=42))
    raw = image.tobytes()
    runlength = b"".join(bytes([len(raw[i:i+128]) - 1]) + raw[i:i+128] for i in range(0, len(raw), 128)) + bytes([128])
    encoded = base64.a85encode(runlength) + b"~>"
    decoded = base64.a85decode(encoded[:-2])
    rebuilt = bytearray()
    position = 0
    while decoded[position] != 128:
        length = decoded[position] + 1
        rebuilt.extend(decoded[position + 1:position + 1 + length])
        position += length + 1
    assert bytes(rebuilt) == raw
    objects = pages([b"q 504 0 0 105 48 500 cm /Im1 Do Q"])
    objects[4] = objects[4].replace(b"/Resources << /Font << /F1 3 0 R >> >>", b"/Resources << /XObject << /Im1 6 0 R >> >>")
    objects[6] = stream(encoded, b"/Type /XObject /Subtype /Image /Width 720 /Height 150 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter [/ASCII85Decode /RunLengthDecode]")
    return build(objects)[0]


def expected(page_count=1, text=None, **values):
    base = {"outcomes": [SUPPORTED, WARNING], "mode": "embedded-text-only", "selectedPages": [1], "pageCount": page_count, "requiredText": [] if text is None else [{"page": 1, "text": text}], "forbiddenText": [], "failedPages": [], "safeErrorCodes": [], "warningCodes": [], "emptyPages": [], "requiresRender": False}
    base.update(values)
    return base


def add_active_render_variant(manifest):
    """Add one distinct browser contract while reusing the same immutable bytes."""
    if any(fixture["id"] == "active-content-render" for fixture in manifest["fixtures"]):
        return
    variant = copy.deepcopy(next(fixture for fixture in manifest["fixtures"] if fixture["id"] == "active-content"))
    variant["id"] = "active-content-render"
    variant["expected"]["mode"] = "ocr-all"
    variant["expected"]["requiresRender"] = True
    variant["notes"].append("Additive render/OCR contract reuses the identical active-content.pdf SHA. Ordinary page caption remains required, script/attachment payloads forbidden; no requirement to include or exclude visible form appearance text.")
    manifest["fixtures"].append(variant)


def add_valid_hybrid(manifest):
    """Keep the original conflicting-entry sample; add a compatible incremental hybrid."""
    if any(fixture["id"] == "hybrid-reference-valid" for fixture in manifest["fixtures"]):
        return
    base, previous_xref, _ = build(pages([content("VALID HYBRID PAGE 31415")]))
    info_object = b"<< /Title (HYBRID OPTIONAL INFO 27182) /Producer (LocalOCR bounded synthetic fixture) >>"
    object_header = b"8 0 "
    objstream = stream(zlib.compress(object_header + info_object, 9), b"/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode")
    data = bytearray(base)
    offset6 = len(data)
    data.extend(b"6 0 obj\n" + objstream + b"\nendobj\n")
    offset7 = len(data)
    entry8 = bytes([2]) + (6).to_bytes(4, "big") + (0).to_bytes(2, "big")
    data.extend(b"7 0 obj\n" + stream(entry8, b"/Type /XRef /Size 9 /W [1 4 2] /Index [8 1]") + b"\nendobj\n")
    update_xref = len(data)
    data.extend(f"xref\n6 2\n{offset6:010d} 00000 n \n{offset7:010d} 00000 n \ntrailer\n<< /Size 9 /Root 1 0 R /Info 8 0 R /Prev {previous_xref} /XRefStm {offset7} >>\nstartxref\n{update_xref}\n%%EOF\n".encode())
    result = bytes(data)
    parsed = PdfReader(io.BytesIO(result))
    assert parsed.metadata.title == "HYBRID OPTIONAL INFO 27182"
    assert "VALID HYBRID PAGE 31415" in parsed.pages[0].extract_text()
    assert result.startswith(base) and result.count(b"%%EOF") == 2
    path = FILES / "hybrid-reference-valid.pdf"
    if path.exists() and path.read_bytes() != result:
        raise RuntimeError("Refusing to overwrite different valid hybrid fixture")
    path.write_bytes(result)
    process = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True, timeout=15)
    assert process.returncode == 0 and process.stderr == ""
    assert "HYBRID OPTIONAL INFO 27182" in process.stdout
    manifest["fixtures"].append({"id": "hybrid-reference-valid", "category": "hybrid-reference", "categories": ["hybrid-reference", "incremental-update", "optional-compressed-info"], "availability": "available", "file": path.relative_to(ROOT).as_posix(), "bytes": len(result), "sha256": sha(result), "expected": expected(text="VALID HYBRID PAGE 31415"), "structureAssertions": ["Original complete ordinary one-page PDF is preserved byte-for-byte; update table contains only new ObjStm6 and XRefStream7 entries, with Prev pointing to original xref.", "Supplemental XRefStream7 Index=[8,1] contains type2(objectstream6,index0); no current table entry conflicts with compressed Info8.", "Catalog/Pages/Page/Font/Contents all remain uncompressed and independently readable; optional Info8 is inside ObjStm6.", "Independent pypdf metadata and Poppler pdfinfo both resolve exact Title HYBRID OPTIONAL INFO 27182; Poppler emits no xref-reconstruction diagnostic."], "notes": ["Additive fixture preserves the original conflicting-entry hybrid bytes, unsupported expectation and initial native failure. This fixture was independently verified before its browser run.", "The app does not request getMetadata. Native ordinary-page extraction proves opening/processing this structurally verified hybrid; it does not prove app consumption of optional compressed Info."]})
    (EVIDENCE / "valid-hybrid-independent.json").write_text(json.dumps({"sha256": sha(result), "bytes": len(result), "baseBytes": len(base), "previousXref": previous_xref, "objStreamOffset": offset6, "xrefStreamOffset": offset7, "updateXrefOffset": update_xref, "compressedObject": 8, "xrefStreamEntryHex": entry8.hex(), "pypdfTitle": parsed.metadata.title, "pdfinfoExitCode": process.returncode, "pdfinfoStdout": process.stdout, "pdfinfoStderr": process.stderr}, indent=2) + "\n", encoding="utf-8")


def add_contained_huge_text(manifest):
    """Expose the full hidden string within the viewBox; preserve the clipped original."""
    if any(fixture["id"] == "huge-text-layer-contained" for fixture in manifest["fixtures"]):
        return
    hidden_text = "A" * 250001
    font_size = .001
    x, y = 10, 10
    width = stringWidth(hidden_text, "Helvetica", font_size)
    assert abs(width - 166.750667) < .000001
    assert 0 < x < x + width < 612 and 0 < y - font_size < y + font_size < 792
    data = content("HUGE TEXT LAYER LIMIT TEST") + b"BT /F1 0.001 Tf 3 Tr 10 10 Td (" + hidden_text.encode("ascii") + b") Tj ET\n"
    assert len(data) < 256 * 1024
    result = build(pages([data]))[0]
    parsed = PdfReader(io.BytesIO(result))
    parsed_text = parsed.pages[0].extract_text()
    assert len(parsed_text) == 250028 and hidden_text in parsed_text
    parsed_stream = parsed.pages[0].get_contents().get_data()
    assert parsed_stream == data
    assert b"/F1 0.001 Tf 3 Tr 10 10 Td" in parsed_stream
    assert b"/BaseFont /Helvetica" in result
    path = FILES / "huge-text-layer-contained.pdf"
    if path.exists() and path.read_bytes() != result:
        raise RuntimeError("Refusing to overwrite different contained huge text fixture")
    path.write_bytes(result)
    manifest["fixtures"].append({"id": "huge-text-layer-contained", "category": "huge-text-layer", "categories": ["huge-text-layer", "within-page-hidden-glyphs"], "availability": "available", "file": path.relative_to(ROOT).as_posix(), "bytes": len(result), "sha256": sha(result), "expected": expected(outcomes=[FAILED], failedPages=[1], safeErrorCodes=["PDF_PAGE_TEXT_LIMIT_EXCEEDED"]), "structureAssertions": ["One hidden Helvetica Tj string contains exactly 250001 ASCII/UTF-16 characters at font size 0.001pt and origin (10,10).", "Independent Helvetica width metrics give total advance166.750667pt and final x176.750667, entirely inside MediaBox[0,0,612,792]; vertical glyph bounds conservatively remain between9.999 and10.001pt.", "Independent pypdf extracts250028 total characters and the exact250001-character hidden string; entire uncompressed page content is below256KiB."], "notes": ["Additive correction preserves original huge-text-layer bytes, support-limit expectation and initial browser mismatch. Original1pt hidden line extended outside viewBox and PDF.js yielded only930characters, so it did not exercise the application limit.", "This one-page limit test requires a safe page failure with no successful partial text; it does not prove later-page continuation. No OCR or recognition quality claim is involved."]})
    proof = {"sha256": sha(result), "bytes": len(result), "pageCount": 1, "mediaBox": [0, 0, 612, 792], "font": "Helvetica", "fontSizePoints": font_size, "renderingMode": 3, "textOriginPoints": [x, y], "hiddenCharacters": len(hidden_text), "pypdfExtractedCharacters": len(parsed_text), "contentStreamBytes": len(data), "independentAdvancePoints": width, "finalXPoints": x + width, "conservativeVerticalBoundsPoints": [y - font_size, y + font_size], "coordinateVerification": "ReportLab Helvetica AFM width metrics plus exact source font, Tf, Tr, Td and MediaBox assertions; not native PDF.js output.", "scope": "Source-geometry correction only; application limit behavior awaits an independent native browser run."}
    (EVIDENCE / "contained-huge-text-independent.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")


def generate():
    FILES.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    fixtures = []

    def add(identifier, category, data, contract, assertions, notes=None, categories=None):
        path = FILES / f"{identifier}.pdf"
        if path.exists() and path.read_bytes() != data:
            raise RuntimeError(f"Refusing to overwrite different existing fixture: {path}")
        path.write_bytes(data)
        fixtures.append({"id": identifier, "category": category, "categories": categories or [category], "availability": "available", "file": path.relative_to(ROOT).as_posix(), "bytes": len(data), "sha256": sha(data), "expected": contract, "structureAssertions": assertions, "notes": notes or []})

    baseline, previous_xref, offsets = build(pages([content("COMPLEX BASE REVISION 13579")]))
    add("control-simple", "control", baseline, expected(text="COMPLEX BASE REVISION 13579"), ["Ordinary xref table offsets generated from exact object bytes; one Helvetica text page."])
    add("truncated", "truncated-file", baseline[:64], expected(page_count=None, outcomes=[REJECTED], selectedPages=[], safeErrorCodes=["PDF_OPEN_FAILED"], rejectionStage="selection"), ["Only the first 64 bytes of control-simple remain; root/page/content objects and trailer are absent."])
    bad_table = baseline.replace(f"{offsets[4]:010d} 00000 n".encode(), b"0000000001 00000 n", 1)
    add("invalid-xref-table", "invalid-xref-table", bad_table, expected(text="COMPLEX BASE REVISION 13579"), ["Page object xref offset is 1, inside the PDF header; all object bodies remain complete."], ["Expected parser recovery is tested without requiring an app warning; PDF.js console diagnostics are not user-visible warnings."])
    objstream = object_stream_pdf()
    add("object-streams", "object-streams", objstream, expected(text="OBJECT STREAM SENTINEL 31415"), ["Catalog, Pages, Font and Page objects reside inside one Flate ObjStm with N=4 and verified First offset.", "XRef stream uses W=[1,4,2], four type-2 entries and exact type-1 offsets; independent pypdf extracts the sentinel."])
    broken_stream = objstream.replace(b"/W [1 4 2]", b"/W [1 0 0]")
    add("invalid-xref-stream", "invalid-xref-stream", broken_stream, expected(text="OBJECT STREAM SENTINEL 31415", outcomes=[SUPPORTED, WARNING, REJECTED], safeErrorCodes=["PDF_OPEN_FAILED"], rejectionStage="selection"), ["XRef W=[1,0,0] cannot represent original offset/object-stream-index fields; catalog remains inside compressed objects."], ["Before native browser evaluation, independent parsers disagree: pypdf rejects missing Root while Poppler recovers the page. Either safe selection rejection or complete sentinel extraction is acceptable; silent incomplete success is not."])
    add("hybrid-reference", "hybrid-reference", object_stream_pdf(True), expected(text="OBJECT STREAM SENTINEL 31415"), ["Traditional trailer XRefStm points at a supplementary XRef stream containing the compressed Page object's type-2 entry.", "Catalog/Pages/Font/Contents remain table-referenced; independent pypdf resolves compressed Page and extracts sentinel."])
    new_stream = stream(content("COMPLEX CURRENT REVISION 24680"))
    appended = b"5 0 obj\n" + new_stream + b"\nendobj\n"
    new_xref = len(baseline) + len(appended)
    incremental = baseline + appended + f"xref\n5 1\n{len(baseline):010d} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R /Prev {previous_xref} >>\nstartxref\n{new_xref}\n%%EOF\n".encode()
    assert incremental.startswith(baseline) and incremental.count(b"%%EOF") == 2
    assert "CURRENT REVISION" in PdfReader(io.BytesIO(incremental)).pages[0].extract_text()
    add("incremental-update", "incremental-update", incremental, expected(text="COMPLEX CURRENT REVISION 24680", forbiddenText=[{"page": 1, "text": "COMPLEX BASE REVISION 13579"}]), ["Exact baseline bytes form revision 1; appended replacement Contents object 5 and xref subsection form revision 2; Prev equals original startxref."])
    nested = b"[" * 2048 + b"0" + b"]" * 2048 + b" pop\n"
    assert len(nested) < 32768
    add("nested-content-array", "nested-objects", build(pages([nested + content("BOUNDED NESTING SENTINEL 2048")]))[0], expected(text="BOUNDED NESTING SENTINEL 2048"), ["Reachable page content contains 2048 nested array levels (4102 bytes), then an independent text operator.", "Only bounded syntax; no recursive indirect-object cycle or unbounded pressure."], ["Unknown content operator pop discards the array operand; this fixture exercises parsing rather than valid graphics semantics."])
    length_objects = pages([content("DECLARED LENGTH SENTINEL 8388")])
    length_objects[5] = stream(content("DECLARED LENGTH SENTINEL 8388"), declared=8388608)
    add("declared-stream-length", "declared-stream-pressure", build(length_objects)[0], expected(text="DECLARED LENGTH SENTINEL 8388"), ["Contents declares 8,388,608 bytes but the physical stream contains fewer than 200 bytes; complete endstream/xref remain."])
    decoded = b"% bounded comment padding\n" * ((4 * 1024 * 1024) // 26) + content("BOUNDED FLATE SENTINEL 4096")
    assert len(decoded) < 5 * 1024 * 1024
    pressure = pages([b""])
    pressure[5] = stream(zlib.compress(decoded, 9), b"/Filter /FlateDecode")
    assert zlib.decompress(zlib.compress(decoded, 9)) == decoded
    add("flate-pressure", "bounded-decompression", build(pressure)[0], expected(text="BOUNDED FLATE SENTINEL 4096"), [f"A single Flate stream expands to exactly {len(decoded)} bytes of benign comments and text, below the 10 MiB budget."])
    add("zero-page", "zero-page", build(pages([]))[0], expected(page_count=0, outcomes=[REJECTED], selectedPages=[], safeErrorCodes=["PDF_OPEN_FAILED"], rejectionStage="selection"), ["Valid catalog and Pages tree with Count=0 and empty Kids; no Page objects."])
    add("blank-pages-26", "many-blank-pages", build(pages([b""] * 26))[0], expected(page_count=26, selectedPages=list(range(1, 27)), emptyPages=list(range(1, 27)), outcomes=[WARNING]), ["26 independent Page objects, each with a zero-length Contents stream; below document and selection limits, above the 25-page OCR limit."], ["Primary contract uses embedded text only. This fixture does not by itself test cancellation or the OCR limit; those require a separate UI action."])
    extreme_size = (14400, 14400)
    add("extreme-dimensions", "extreme-dimensions", build(pages([content("EXTREME PAGE 4096", extreme_size, 400)], [extreme_size]))[0], expected(text="EXTREME PAGE 4096", mode="ocr-all", outcomes=[WARNING], requiresRender=True, downscaled=True, downscaledPages=[1], warningCodes=["PAGE_RENDER_REDUCED"]), ["MediaBox=14400x14400 points; 400-point Helvetica text remains legible at a 4096-pixel maximum side."])
    sizes = [(612, 792), (300, 300), (14400, 3600)]
    mixed = [content(f"SIZE PAGE {index + 1}", size, 400 if index == 2 else 24) for index, size in enumerate(sizes)]
    add("mixed-dimensions", "mixed-dimensions", build(pages(mixed, sizes))[0], expected(page_count=3, selectedPages=[1, 2, 3], mode="ocr-all", outcomes=[WARNING], requiresRender=True, downscaledPages=[3], warningCodes=["PAGE_RENDER_REDUCED"], requiredText=[{"page": i, "text": f"SIZE PAGE {i}"} for i in [1, 2, 3]]), ["MediaBoxes independently equal 612x792, 300x300 and 14400x3600 points; page 3 requires render reduction."])
    huge = content("HUGE TEXT LAYER LIMIT TEST") + b"BT /F1 1 Tf 3 Tr 10 10 Td (" + b"A" * 250001 + b") Tj ET\n"
    add("huge-text-layer", "huge-text-layer", build(pages([huge]))[0], expected(outcomes=[FAILED], failedPages=[1], safeErrorCodes=["PDF_PAGE_TEXT_LIMIT_EXCEEDED"]), ["Single hidden Tj string has exactly 250001 ASCII/UTF-16 characters, above the 250000-character page cap; visible caption adds further text."], ["Failure is required; silent truncation or apparent successful partial extraction is not acceptable. One-page file has no later page to continue."])
    damaged = pages([b"", content("UNDAMAGED SECOND PAGE 86420")])
    damaged[5] = stream(b"INVALID_ZLIB_HEADER_12345", b"/Filter /FlateDecode")
    try:
        zlib.decompress(b"INVALID_ZLIB_HEADER_12345")
        raise AssertionError("Expected invalid zlib")
    except zlib.error:
        pass
    add("damaged-page", "damaged-page-continuation", build(damaged)[0], expected(page_count=2, selectedPages=[1, 2], mode="automatic", outcomes=[FAILED], failedPages=[1], safeErrorCodes=["PDF_PAGE_RENDER_FAILED", "PDF_PAGE_TEXT_EXTRACTION_FAILED"], requiredText=[{"page": 2, "text": "UNDAMAGED SECOND PAGE 86420"}]), ["Page 1 Contents FlateDecode bytes independently fail zlib header validation; page 2 has a separate valid plain text stream."], ["Must fail page 1 safely and preserve page 2 output; no runtime error string is permitted in UI."])
    add("active-content", "active-content", active_pdf(), expected(text="ACTIVE CONTENT TEST 12345", outcomes=[SUPPORTED, UNSUPPORTED], forbiddenText=[{"page": 1, "text": "ATTACHMENT_PAYLOAD_SHOULD_NOT_BE_EXTRACTED_1618"}, {"page": 1, "text": "PDF_JS_SHOULD_NOT_RUN_2718"}]), ["Catalog EmbeddedFiles, JavaScript Names and OpenAction refer to real reachable objects.", "Link annotations contain URI about:blank and Launch of a nonexistent local .txt file; field AA/U points to SubmitForm about:blank.", "AcroForm Fields entries are the exact merged Widget references in page Annots; text field V matches its explicit appearance stream.", "XFA contains a bounded static XML template with no script/external resource; signature marker ByteRange=[0,0,0,0], Contents=<00> is deliberately invalid."], ["No real trusted signature, certificate, live endpoint, executable launch, form submission, or attachment extraction is involved. Visible form appearances may legitimately appear in OCR output. Feature non-execution requires separate browser evidence."], ["attachments", "javascript-actions", "links-launch", "acroforms", "xfa", "invalid-signature-marker"])
    add("runlength-ascii85-image", "additional-compression", image_pdf(), expected(text="RUNLENGTH ASCII85 2468", mode="ocr-all", requiresRender=True), ["Image XObject uses ordered ASCII85Decode then RunLengthDecode; independently decoded bytes exactly match 720x150 8-bit grayscale pixels (108000 bytes)."])
    assert len(fixtures) == 18
    corpus = json.loads((ROOT / "tools/pdf-release/corpus.json").read_text(encoding="utf-8"))
    source = next(case for case in corpus["cases"] if case["filename"] == "cfpb-savings.pdf")
    linear_path = ROOT / "tmp/pdf-release-corpus/cfpb-savings.pdf"
    linear_bytes = linear_path.read_bytes()
    assert sha(linear_bytes) == source["sha256"] == "cf2cd999815792281b9639ee41536f591fed42fb9c2406b149a06dbae637be3e"
    header = linear_bytes[:1024]
    assert re.search(rb"/Linearized\s+1", header)
    assert int(re.search(rb"/L\s+(\d+)", header)[1]) == len(linear_bytes)
    info = subprocess.run(["pdfinfo", str(linear_path)], capture_output=True, timeout=15, text=True)
    assert re.search(r"Optimized:\s+yes", info.stdout)
    reader = PdfReader(io.BytesIO(linear_bytes))
    first_text = reader.pages[0].extract_text()
    assert "savings" in first_text.lower()
    fixtures.append({"id": "linearized-cfpb-savings", "category": "linearized", "categories": ["linearized", "public-form"], "availability": "available", "file": linear_path.relative_to(ROOT).as_posix(), "bytes": len(linear_bytes), "sha256": sha(linear_bytes), "source": source["source"], "rights": source["rights"], "expected": expected(page_count=len(reader.pages), text="savings"), "structureAssertions": ["Original corpus SHA is unchanged; Linearized /L exactly matches file bytes; independent Poppler reports Optimized yes.", "Independent pypdf resolves all three pages and first-page savings text."], "notes": ["Existing public source reused byte-for-byte; not newly authored or copied. Offline behavior needs native browser evidence, not just this structure check."]})
    manifest = {"schemaVersion": 1, "createdAt": "2026-09-06", "scope": "18 bounded synthetic PDFs and one reused lawful public linearized file. Native browser results are separate. No fixtures belong in deployed output.", "generator": "tools/pdf-release/complex-fixtures.py", "bounds": {"maximumDeclaredStreamBytes": 8388608, "maximumDecodedStreamBytes": 10485760, "maximumNestedSyntaxBytes": 32768, "nestedArrayDepth": 2048}, "fixtures": fixtures, "untestedCategories": [{"category": "unbounded-hostile-resources", "reason": "No decompression bomb, cyclic page tree, multi-gigabyte declaration, or destructive stress input is generated; bounded samples cannot close unbounded resource safety."}, {"category": "valid-cryptographic-signature", "reason": "Only an explicitly invalid synthetic signature marker is included. Trust validation and real signed documents remain unsupported/unverified."}, {"category": "additional-compression-not-covered", "reason": "This bundle adds RunLengthDecode plus ASCII85; LZW and CCITT are not covered here. Existing separate upstream cases cover JPX, JBIG2 and ICC."}, {"category": "dynamic-xfa", "reason": "Only static bounded XFA packet presence is covered. Complex dynamic XFA execution/rendering is intentionally unsupported."}, {"category": "physical-memory-pressure", "reason": "No physical-device resource or platform support claim follows from these desktop-bounded fixtures."}]}
    add_active_render_variant(manifest)
    add_valid_hybrid(manifest)
    add_contained_huge_text(manifest)
    manifest["scope"] = "20 bounded synthetic PDFs and one reused lawful public linearized file; 22 contracts include active-content OCR reuse. Native browser results are separate. No fixtures belong in deployed output."
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"fixtureCount": len(fixtures), "newPdfs": 20, "manifest": str(MANIFEST), "manifestSha256": sha(MANIFEST.read_bytes())}))


def inspect_one(path):
    reader = PdfReader(path)
    result = {"pages": len(reader.pages), "pageSizes": [], "characters": [], "textSha256": []}
    for page in reader.pages:
        result["pageSizes"].append([float(page.mediabox.width), float(page.mediabox.height)])
        text = page.extract_text()
        result["characters"].append(len(text))
        result["textSha256"].append(sha(text.encode("utf-8")))
    print(json.dumps(result))


def inspect():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    results = []
    for fixture in manifest["fixtures"]:
        path = ROOT / fixture["file"]
        assert sha(path.read_bytes()) == fixture["sha256"]
        item = {"id": fixture["id"], "sha256": fixture["sha256"]}
        commands = {"pypdf": [sys.executable, str(Path(__file__).resolve()), "inspect-one", str(path)], "pdfinfo": ["pdfinfo", str(path)]}
        for tool, command in commands.items():
            try:
                process = subprocess.run(command, capture_output=True, timeout=20, text=True, encoding="utf-8", errors="replace")
                item[tool] = {"exitCode": process.returncode, "stdout": process.stdout[:12000], "stderr": process.stderr[-2500:]}
            except subprocess.TimeoutExpired:
                item[tool] = {"timeoutSeconds": 20}
        results.append(item)
        print(f"Inspected {fixture['id']}", flush=True)
    (EVIDENCE / "parser-inspection.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


def render():
    """Bound every Poppler output to 900 pixels; never render huge pages at native DPI."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    results = []
    for fixture in manifest["fixtures"]:
        if fixture["id"] in ["truncated", "zero-page"]:
            continue
        path = ROOT / fixture["file"]
        assert sha(path.read_bytes()) == fixture["sha256"]
        selected = [1, 2, 3] if fixture["id"] == "mixed-dimensions" else [1, 2] if fixture["id"] == "damaged-page" else [1]
        for page in selected:
            prefix = EVIDENCE / f"{fixture['id']}-page-{page}"
            item = {"id": fixture["id"], "page": page}
            try:
                process = subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-scale-to", "900", "-png", str(path), str(prefix)], capture_output=True, text=True, timeout=25)
                item.update({"exitCode": process.returncode, "stderr": process.stderr[-1500:], "png": prefix.with_suffix(".png").relative_to(ROOT).as_posix() if prefix.with_suffix(".png").exists() else None})
            except subprocess.TimeoutExpired:
                item["timeoutSeconds"] = 25
            results.append(item)
            print(f"Rendered {fixture['id']} page {page}", flush=True)
    (EVIDENCE / "render-inspection.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


def verify():
    """Read-only source-structure and identity checks; never evaluates app outputs."""
    manifest_bytes = MANIFEST.read_bytes()
    manifest = json.loads(manifest_bytes)
    fixture_map = {fixture["id"]: fixture for fixture in manifest["fixtures"]}
    checked = []
    for fixture in manifest["fixtures"]:
        data = (ROOT / fixture["file"]).read_bytes()
        assert len(data) == fixture["bytes"] and sha(data) == fixture["sha256"]
        checked.append(fixture["id"])
    def file(identifier):
        return (ROOT / fixture_map[identifier]["file"]).read_bytes()
    def reader(identifier):
        return PdfReader(io.BytesIO(file(identifier)))
    nested_stream = reader("nested-content-array").pages[0].get_contents().get_data()
    assert nested_stream.startswith(b"[" * 2048 + b"0" + b"]" * 2048 + b" pop\n")
    flate_decoded = reader("flate-pressure").pages[0].get_contents().get_data()
    assert len(flate_decoded) < 10 * 1024 * 1024 and b"BOUNDED FLATE SENTINEL 4096" in flate_decoded
    huge_stream = reader("huge-text-layer").pages[0].get_contents().get_data()
    assert len(re.search(rb"\((A+)\) Tj", huge_stream)[1]) == 250001
    assert len(reader("huge-text-layer").pages[0].extract_text()) == 250028
    assert len(reader("blank-pages-26").pages) == 26
    assert all(page.extract_text() == "" for page in reader("blank-pages-26").pages)
    assert len(reader("zero-page").pages) == 0
    assert file("incremental-update").startswith(file("control-simple"))
    assert "CURRENT REVISION 24680" in reader("incremental-update").pages[0].extract_text()
    assert "BASE REVISION" not in reader("incremental-update").pages[0].extract_text()
    for identifier in ["object-streams", "hybrid-reference"]:
        assert b"/ObjStm" in file(identifier) and b"/Type /XRef" in file(identifier)
        assert "OBJECT STREAM SENTINEL 31415" in reader(identifier).pages[0].extract_text()
    hybrid = file("hybrid-reference")
    stream_offset = int(re.search(rb"/XRefStm (\d+)", hybrid)[1])
    assert hybrid[stream_offset:].startswith(b"7 0 obj")
    linear = file("linearized-cfpb-savings")
    head = linear[:1024]
    linear_length = int(re.search(rb"/L\s+(\d+)", head)[1])
    linear_count = int(re.search(rb"/N\s+(\d+)", head)[1])
    hint_offset, hint_length = map(int, re.search(rb"/H\s*\[\s*(\d+)\s+(\d+)\s*\]", head).groups())
    assert linear_length == len(linear) == 79250 and linear_count == 3
    assert 0 < hint_offset < hint_offset + hint_length <= len(linear)
    assert b"obj" in linear[hint_offset:hint_offset + 25]
    synthetic_files = {fixture["file"]: fixture["bytes"] for fixture in manifest["fixtures"] if fixture["id"] != "linearized-cfpb-savings"}
    proof = {"manifestSha256": sha(manifest_bytes), "checkedFixtureIdentities": checked, "syntheticTotalBytes": sum(synthetic_files.values()), "boundedFlateDecodedBytes": len(flate_decoded), "nestedDepth": 2048, "nestedSyntaxBytes": 4102, "hugeHiddenStringCharacters": 250001, "hugePypdfExtractedCharacters": 250028, "linearized": {"L": linear_length, "N": linear_count, "H": [hint_offset, hint_length], "hintObjectAtDeclaredOffset": True}, "scope": "Source structure and identity only; no app, offline, active execution, worker memory, or signature trust result."}
    (EVIDENCE / "structure-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(proof))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "inspect-one":
        inspect_one(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] == "inspect":
        inspect()
    elif len(sys.argv) > 1 and sys.argv[1] == "render":
        render()
    elif len(sys.argv) > 1 and sys.argv[1] == "verify":
        verify()
    elif len(sys.argv) > 1 and sys.argv[1] == "add-active-render":
        current = json.loads(MANIFEST.read_text(encoding="utf-8"))
        add_active_render_variant(current)
        MANIFEST.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(sha(MANIFEST.read_bytes()))
    elif len(sys.argv) > 1 and sys.argv[1] == "add-valid-hybrid":
        current = json.loads(MANIFEST.read_text(encoding="utf-8"))
        add_valid_hybrid(current)
        current["scope"] = "19 bounded synthetic PDFs and one reused lawful public linearized file; 21 contracts include active-content OCR reuse. Native browser results are separate. No fixtures belong in deployed output."
        MANIFEST.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(sha(MANIFEST.read_bytes()))
    elif len(sys.argv) > 1 and sys.argv[1] == "add-contained-huge-text":
        before = MANIFEST.read_bytes()
        snapshot = EVIDENCE / "manifest-before-contained-text.json"
        if snapshot.exists() and snapshot.read_bytes() != before:
            raise RuntimeError("Preserve the first pre-correction manifest snapshot")
        snapshot.write_bytes(before)
        current = json.loads(before)
        add_contained_huge_text(current)
        current["scope"] = "20 bounded synthetic PDFs and one reused lawful public linearized file; 22 contracts include active-content OCR reuse. Native browser results are separate. No fixtures belong in deployed output."
        assert current["fixtures"][:-1] == json.loads(before)["fixtures"]
        MANIFEST.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(sha(MANIFEST.read_bytes()))
    else:
        generate()
