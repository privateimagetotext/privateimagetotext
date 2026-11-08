"""Read-only source inspection for six frozen derived real-source PDF pages.

Does not author PDFs, access the network or read application output. The source
HTML supplies semantic RTL strings; pypdf is only an independent inspection aid.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

import pypdf
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp/pdf-diversity-20260906/review-source"
SOURCES = (
    ("w3c-inline-bidi", "browser-print", (2, 7),
     "c08cbfe973320535fa617f5275e41d265e50ce0659e06262bc3df28833897be7"),
    ("w3c-vertical", "browser-print", (6, 8, 22),
     "99a0d96ce74e3416ec2a6ba94ed8615488bd545aba2850efb895332ea4207077"),
    ("cord-train-9-receipt", "receipt", (1,),
     "caee9e603e1c6ec34680055af4aa39e5d87f6472d5af15ece366fc1bcc2e86d9"),
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    pdftoppm = shutil.which("pdftoppm")
    pdfinfo = shutil.which("pdfinfo")
    if not pdftoppm or not pdfinfo:
        raise RuntimeError("Poppler pdftoppm/pdfinfo must be installed")
    if OUT.exists():
        raise RuntimeError("Refusing to replace frozen source evidence")
    OUT.mkdir(parents=True)
    rows = []
    for source_id, folder, selected, expected_sha in SOURCES:
        pdf = ROOT / f"tmp/pdf-diversity-20260906/{folder}/{source_id}.pdf"
        assert sha(pdf) == expected_sha, f"Unexpected source bytes: {source_id}"
        assert pdf.stat().st_size <= 2 * 1024 * 1024
        reader = pypdf.PdfReader(pdf)
        info = subprocess.run(
            [pdfinfo, str(pdf)], capture_output=True, check=True, timeout=30,
        )
        info_path = OUT / f"{source_id}-pdfinfo.txt"
        info_path.write_bytes(info.stdout)
        entry = {
            "id": source_id, "pdfPath": rel(pdf), "bytes": pdf.stat().st_size,
            "sha256": expected_sha, "pageCount": len(reader.pages),
            "pdfinfoPath": rel(info_path), "pdfinfoSha256": sha(info_path),
            "pages": [],
        }
        for number in selected:
            page = reader.pages[number - 1]
            text = page.extract_text() or ""
            assert len(text) <= 50_000
            text_path = OUT / f"{source_id}-p{number}.txt"
            text_path.write_bytes(text.encode("utf-8"))
            prefix = OUT / f"{source_id}-p{number}"
            rendered = subprocess.run(
                [pdftoppm, "-f", str(number), "-l", str(number),
                 "-singlefile", "-scale-to", "1800", "-png",
                 str(pdf), str(prefix)],
                capture_output=True, check=True, timeout=60,
            )
            image_path = prefix.with_suffix(".png")
            with Image.open(image_path) as image:
                size = list(image.size)
                assert max(size) <= 1800
            entry["pages"].append({
                "number": number, "imagePath": rel(image_path),
                "imageSha256": sha(image_path), "imageSize": size,
                "independentTextPath": rel(text_path),
                "independentTextSha256": sha(text_path),
                "independentTextCharacters": len(text),
                "pageSizePoints": [float(page.mediabox.width), float(page.mediabox.height)],
                "rotationDegrees": page.rotation,
                "renderStderr": rendered.stderr.decode("utf-8", errors="replace"),
            })
        rows.append(entry)
    manifest = {
        "schemaVersion": 1,
        "scope": "Read-only full six-page source inspection; no application output read or PDF authoring.",
        "pypdfVersion": pypdf.__version__,
        "popplerVersion": subprocess.run(
            [pdftoppm, "-v"], capture_output=True, check=True, timeout=10,
        ).stderr.decode("utf-8", errors="replace").strip(),
        "generatorPath": rel(Path(__file__).resolve()),
        "generatorSha256": sha(Path(__file__)),
        "documents": rows,
    }
    path = OUT / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": rel(path), "sha256": sha(path), "pages": 6}))


if __name__ == "__main__":
    main()
