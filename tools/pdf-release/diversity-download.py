"""Bounded, public-only provenance acquisition; never reads user documents."""
import datetime
import hashlib
import json
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp/pdf-diversity-20260906/source"
OUT.mkdir(parents=True, exist_ok=False)

def fetch(url, maximum=5_000_000):
    request = urllib.request.Request(url, headers={"User-Agent": "LocalOCR-PDF-release-review/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = bytearray()
        while chunk := response.read(65536):
            content.extend(chunk)
            if len(content) > maximum:
                raise ValueError("Public source exceeds bounded download limit")
        return bytes(content), response.geturl(), response.headers.get("Content-Type")

records = []
for name, url in [
    ("w3c-inline-bidi.html", "https://www.w3.org/International/articles/inline-bidi-markup/"),
    ("w3c-vertical.html", "https://www.w3.org/International/articles/vertical-text/"),
    ("w3c-document-license.html", "https://www.w3.org/copyright/document-license-2023/"),
    ("cord-readme.md", "https://raw.githubusercontent.com/clovaai/cord/master/README.md"),
]:
    data, final_url, content_type = fetch(url)
    (OUT / name).write_bytes(data)
    records.append({"file": name, "url": url, "finalUrl": final_url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "contentType": content_type, "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})

row_url = "https://datasets-server.huggingface.co/rows?dataset=naver-clova-ix%2Fcord-v2&config=default&split=train&offset=9&length=1"
row_data, _, _ = fetch(row_url)
row = json.loads(row_data)["rows"][0]
assert row["row_idx"] == 9 and not row.get("truncated_cells")
ground_truth = row["row"]["ground_truth"]
truth = json.loads(ground_truth)
image_url = row["row"]["image"]["src"]
parsed = urllib.parse.urlsplit(image_url)
assert parsed.scheme == "https" and parsed.netloc == "datasets-server.huggingface.co"
image_data, _, content_type = fetch(image_url)
(OUT / "cord-train-9.jpg").write_bytes(image_data)
(OUT / "cord-train-9-ground-truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
records.append({"file": "cord-train-9.jpg", "dataset": "naver-clova-ix/cord-v2", "split": "train", "row": 9, "rowApi": row_url, "imagePath": urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")), "bytes": len(image_data), "sha256": hashlib.sha256(image_data).hexdigest(), "contentType": content_type, "groundTruthSha256": hashlib.sha256((OUT / "cord-train-9-ground-truth.json").read_bytes()).hexdigest(), "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "selectionReason": "Public viewer shows a short English-menu cash receipt; chosen before application output testing. Visual personal-data and text review is still required."})
(OUT / "download-manifest.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps([{"file": record["file"], "bytes": record["bytes"], "sha256": record["sha256"]} for record in records]))
