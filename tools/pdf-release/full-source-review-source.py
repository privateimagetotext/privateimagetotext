"""Read-only pypdf extraction and Poppler renders of 32 pinned public pages.

No PDFs are authored or edited. Output text is written as exact UTF-8 bytes;
logical-string and actual-file hashes are both recorded to avoid newline drift.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
from datetime import datetime, timezone

import pypdf
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp/pdf-full-source-review-20260906/source"
MANIFEST = ROOT / "tools/pdf-release/corpus.json"
EXPECTED_CORPUS_SHA = "fc702260a034ec5292507661446cb160be090802ce42ffa6faeb79759c91f78d"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def relative(filename: pathlib.Path) -> str:
    return filename.relative_to(ROOT).as_posix()


def main() -> None:
    raw = MANIFEST.read_bytes()
    assert sha(raw) == EXPECTED_CORPUS_SHA, "Original corpus changed"
    entries = [entry for entry in json.loads(raw)["cases"]
               if entry["kind"] == "real-document" and not entry["id"].startswith("cfpb-")]
    assert len(entries) == 16 and sum(len(entry["pages"]) for entry in entries) == 32
    assert all(entry["id"].startswith(("nist-", "irs-")) for entry in entries)
    poppler = shutil.which("pdftoppm")
    assert poppler, "Existing Poppler pdftoppm must be installed on PATH"
    version = subprocess.run([poppler, "-v"], capture_output=True, timeout=10, check=True)
    poppler_version = (version.stdout + version.stderr).decode("utf-8", errors="replace").splitlines()[0]
    OUT.mkdir(parents=True, exist_ok=False)
    records = []
    documents = []
    for entry in entries:
        source = ROOT / "tmp/pdf-release-corpus" / entry["filename"]
        data = source.read_bytes()
        assert len(data) == entry["bytes"] and sha(data) == entry["sha256"], entry["id"]
        reader = pypdf.PdfReader(source)
        documents.append({
            "id": entry["id"], "title": entry["title"], "file": relative(source),
            "bytes": len(data), "sha256": sha(data), "pageCount": len(reader.pages),
            "selectedPages": [item["number"] for item in entry["pages"]],
            "source": entry["source"], "rights": entry["rights"],
        })
        for selected in entry["pages"]:
            number = selected["number"]
            page = reader.pages[number - 1]
            stem = f"{entry['id']}-p{number}"
            text = page.extract_text() or ""
            logical_bytes = text.encode("utf-8")
            text_path = OUT / f"{stem}.txt"
            text_path.write_bytes(logical_bytes)
            text_file = text_path.read_bytes()
            assert text_file == logical_bytes
            command = [poppler, "-f", str(number), "-l", str(number), "-scale-to", "1800", "-singlefile", "-png", str(source), str(OUT / stem)]
            result = subprocess.run(command, check=True, capture_output=True, timeout=60)
            image_path = OUT / f"{stem}.png"
            image_bytes = image_path.read_bytes()
            with Image.open(image_path) as image:
                image.load()
                width, height = image.size
                assert width > 0 and height > 0 and max(width, height) <= 1800
            record = {
                "sourceId": entry["id"], "sourceFile": relative(source), "sourceBytes": len(data), "sourceSha256": sha(data),
                "page": number, "textPath": relative(text_path), "textFileBytes": len(text_file),
                "textCharactersCodePoints": len(text), "textCharactersUtf16": len(text.encode("utf-16-le")) // 2,
                "textFileSha256": sha(text_file), "textLogicalSha256": sha(logical_bytes),
                "logicalHashDefinition": "SHA-256 of exact pypdf Unicode string encoded UTF-8; no normalization or newline conversion",
                "imagePath": relative(image_path), "imageBytes": len(image_bytes), "imageSha256": sha(image_bytes),
                "imageWidth": width, "imageHeight": height,
                "pageSizePoints": [float(page.mediabox.width), float(page.mediabox.height)], "rotationDegrees": page.rotation,
                "extractor": f"pypdf {pypdf.__version__}", "renderer": poppler_version,
                "renderExitCode": result.returncode, "renderStderrBytes": len(result.stderr), "renderStderrSha256": sha(result.stderr),
                "originalExpectation": selected,
                "reviewStatus": "Pending separate complete source-image and application-output comparison; pypdf is not ground truth",
            }
            records.append(record)
            print(json.dumps({"ready": stem, "pageIndex": len(records), "totalPages": 32}), flush=True)
        assert source.read_bytes() == data, "Source PDF changed"
    summary = {
        "schemaVersion": 1, "recordedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCorpusManifestSha256": sha(raw), "python": sys.version, "pypdf": pypdf.__version__,
        "popplerExecutable": poppler, "popplerVersion": poppler_version,
        "scope": "Read-only independent text and max-1800px source renders for the original 32 NIST/NBS and IRS selected pages. No OCR/reference-text repair or PDF authoring.",
        "documentCount": len(documents), "pageCount": len(records), "documents": documents, "pages": records,
    }
    (OUT / "manifest.json").write_bytes((json.dumps(summary, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    assert MANIFEST.read_bytes() == raw
    print(json.dumps({"pagesRendered": len(records), "directory": str(OUT), "manifestSha256": sha((OUT / "manifest.json").read_bytes())}), flush=True)


if __name__ == "__main__":
    main()
