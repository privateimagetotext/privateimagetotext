"""Read-only source rendering for eight pinned public worksheet pages."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import pypdf

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp/pdf-worksheet-review-20260906/source-final"
OUT.mkdir(parents=True, exist_ok=False)
MANIFEST = ROOT / "tools/pdf-release/corpus.json"
raw = MANIFEST.read_bytes()
assert hashlib.sha256(raw).hexdigest() == "fc702260a034ec5292507661446cb160be090802ce42ffa6faeb79759c91f78d"
entries = [entry for entry in json.loads(raw)["cases"] if entry["id"] in ["cfpb-savings", "cfpb-cashflow", "cfpb-spending", "cfpb-debt"]]
assert len(entries) == 4
poppler = shutil.which("pdftoppm")
assert poppler, "Poppler pdftoppm must be installed on PATH"
records = []
for entry in entries:
    source = ROOT / "tmp/pdf-release-corpus" / entry["filename"]
    data = source.read_bytes()
    assert len(data) == entry["bytes"] and hashlib.sha256(data).hexdigest() == entry["sha256"]
    reader = pypdf.PdfReader(source)
    for selected in entry["pages"]:
        number = selected["number"]
        stem = f"{entry['id']}-p{number}"
        text = reader.pages[number - 1].extract_text() or ""
        (OUT / f"{stem}.txt").write_text(text, encoding="utf-8")
        result = subprocess.run([str(poppler), "-f", str(number), "-l", str(number), "-scale-to", "1800", "-singlefile", "-png", str(source), str(OUT / stem)], check=True, capture_output=True, timeout=45)
        image = (OUT / f"{stem}.png").read_bytes()
        records.append({"sourceId": entry["id"], "sourceSha256": entry["sha256"], "page": number, "textCharacters": len(text), "textSha256": hashlib.sha256(text.encode()).hexdigest(), "imageSha256": hashlib.sha256(image).hexdigest(), "extractor": f"pypdf {pypdf.__version__}", "renderer": "Bundled Poppler pdftoppm, scale-to1800", "stderrBytes": len(result.stderr), "visualReview": "Pending complete image and output comparison"})
(OUT / "manifest.json").write_text(json.dumps({"sourceCorpusManifestSha256": hashlib.sha256(raw).hexdigest(), "pages": records}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"pagesRendered": len(records), "directory": str(OUT)}))
