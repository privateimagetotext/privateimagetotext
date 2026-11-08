"""Independent local inspection of the allowlisted release corpus, never app output.

Requires pypdf; --render additionally requires Poppler's pdftoppm on PATH.
All generated text, images, and metadata remain in the ignored corpus directory.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess

import pypdf


parser = argparse.ArgumentParser()
parser.add_argument("--render", action="store_true")
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[2]
base = root / "tmp/pdf-release-corpus"
destination = base / "independent-review"
destination.mkdir(parents=True, exist_ok=True)
manifest = json.loads((root / "tools/pdf-release/corpus.json").read_text(encoding="utf-8"))
rows = []
for entry in manifest["cases"]:
    if entry["kind"] != "real-document":
        continue
    source = base / entry["filename"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != entry["sha256"]:
        raise ValueError(f"Pinned source mismatch: {entry['id']}")
    reader = pypdf.PdfReader(source)
    if len(reader.pages) != entry["pageCount"]:
        raise ValueError(f"Page count mismatch: {entry['id']}")
    for expected in entry["pages"]:
        number = expected["number"]
        page = reader.pages[number - 1]
        text = page.extract_text() or ""
        basename = f"{entry['id']}-p{number}"
        (destination / f"{basename}.txt").write_text(text, encoding="utf-8")
        rows.append({
            "id": entry["id"], "page": number, "extractor": f"pypdf {pypdf.__version__}",
            "characters": len(text), "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "pageSizePoints": [float(page.mediabox.width), float(page.mediabox.height)],
            "rotationDegrees": page.rotation,
            "visualReview": "OPEN - rendering a page does not review it",
        })
        if args.render:
            subprocess.run([
                "pdftoppm", "-f", str(number), "-l", str(number), "-scale-to", "1600",
                "-singlefile", "-png", str(source), str(destination / basename),
            ], check=True)
(destination / "inspection.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
print(f"Independently inspected {len(rows)} selected pages from 20 real public documents.")
