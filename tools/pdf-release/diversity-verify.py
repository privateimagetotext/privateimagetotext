"""Verify the one diversity capture without modifying fixtures or expectations."""
from pathlib import Path
import datetime
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp/pdf-diversity-20260906"
sha = lambda data: hashlib.sha256(data).hexdigest()
read_json = lambda path: json.loads(path.read_text(encoding="utf-8"))
relative = lambda path: path.relative_to(ROOT).as_posix()
expected_path = ROOT / "tools/pdf-release/diversity-corpus.json"
expected_bytes = expected_path.read_bytes()
assert sha(expected_bytes) == "ef014ac6c9fa51898b54701af8ef2d7a3aff4ee7058393ea11b8667e188d2f07"
cases = {item["id"]: item for item in json.loads(expected_bytes)["cases"]}
for case in cases.values():
    data = (ROOT / case["pdfPath"]).read_bytes()
    assert len(data) == case["bytes"] and sha(data) == case["sha256"]
runner_path = OUT / "browser/playwright-results.json"
runner = read_json(runner_path)
assert runner["stats"]["unexpected"] == 9 and runner["stats"]["expected"] == 0 and runner["stats"]["skipped"] == 0
documents = []
grouped = {}
checked_tokens = failed_tokens = 0
evidence_files = sorted((OUT / "browser").glob("*/evidence.json"))
assert len(evidence_files) == 9
for filename in evidence_files:
    evidence = read_json(filename)
    case = cases[evidence["source"]["id"]]
    assert evidence["buildId"] == "bec522230289bdaa1ef063561690034147a1be0bcaafd13fc0f2b31cba2501e2"
    assert evidence["corpusManifestSha256"] == sha(expected_bytes)
    assert evidence["status"] == "failed"
    assert evidence["workersAtEnd"]["active"] == 0
    assert not any(evidence[key] for key in ["outsideOrigins", "unexpectedPaths", "nonReadRequests", "pageErrors"])
    assert len(evidence["pages"]) == len(case["pages"])
    for page in evidence["pages"]:
        expected = next(item for item in case["pages"] if item["number"] == page["page"])
        data = (ROOT / page["outputPath"]).read_bytes()
        text = data.decode("utf-8")
        assert sha(data) == page["outputFileSha256"] == page["outputLogicalSha256"]
        assert len(data) == page["outputFileBytes"] and len(text) == page["charactersCodePoints"]
        assert len(text.encode("utf-16-le")) // 2 == page["charactersUtf16"]
        assert page["hasEditableOutput"] and not page["safeErrors"]
        assert page["method"] == expected["expectedMethod"]
        assert page["charactersUtf16"] >= expected["minimumCharacters"]
        assert [item["token"] for item in page["tokenChecks"]] == expected["expectedTokens"]
        checked_tokens += len(page["tokenChecks"])
        failed_tokens += sum(not item["present"] for item in page["tokenChecks"])
        grouped.setdefault(f"{case['id']}:{page['page']}", []).append({"engine": evidence["browserProject"], "version": evidence["browserVersion"], "outputPath": page["outputPath"], "sha256": sha(data), "charactersUtf16": page["charactersUtf16"], "method": page["method"], "failedTokens": [item["token"] for item in page["tokenChecks"] if not item["present"]], "warnings": page["warnings"]})
    documents.append({"id": case["id"], "engine": evidence["browserProject"], "version": evidence["browserVersion"], "evidencePath": relative(filename), "evidenceSha256": sha(filename.read_bytes()), "assertionFailures": evidence["assertionFailures"], "workersAtEnd": evidence["workersAtEnd"]})
assert len(grouped) == 6 and all(len(values) == 3 for values in grouped.values())
index = {
    "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "scope": "One frozen three-document/six-page Automatic-mode capture in three engines; source-based failures preserved, not a general accuracy rate or release approval.",
    "buildId": documents and evidence["buildId"], "htmlSha256": evidence["htmlHash"],
    "sourceExpectationsPath": relative(expected_path), "sourceExpectationsSha256": sha(expected_bytes),
    "sourceManifestPath": relative(OUT / "review-source/manifest.json"), "sourceManifestSha256": sha((OUT / "review-source/manifest.json").read_bytes()),
    "runnerPath": relative(runner_path), "runnerSha256": sha(runner_path.read_bytes()), "runnerStats": runner["stats"],
    "fileAndLogicalOutputHashesVerified": True, "pdfSourceHashesVerified": True,
    "totalPageEngineOutputs": 18, "correctMethods": 18, "tokenChecks": checked_tokens, "failedTokenChecks": failed_tokens,
    "allObservedWorkersZeroAfterClear": True, "noObservedOutsideOriginsUnexpectedPathsNonReadRequestsOrPageErrors": True,
    "limits": "Service workers blocked; worker construction/termination counters exclude worker-internal allocations and physical memory. Native pipeline and observed requests do not certify every privacy property or deployment.",
    "documents": documents,
    "outputs": [{"sourcePage": key, "allEngineOutputsByteIdentical": len({item['sha256'] for item in values}) == 1, "variants": values} for key, values in sorted(grouped.items())],
    "toolHashes": [{"path": relative(ROOT / name), "sha256": sha((ROOT / name).read_bytes())} for name in ["tools/pdf-release/diversity-review.spec.ts", "tools/pdf-release/playwright.diversity-review.config.ts", "tools/pdf-release/diversity-verify.py"]],
}
target = OUT / "capture-index.json"
assert not target.exists()
target.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps({"index": relative(target), "sha256": sha(target.read_bytes()), "stats": runner["stats"], "correctMethods": 18, "tokenChecks": checked_tokens, "failedTokenChecks": failed_tokens, "outputGroups": [{"page": item["sourcePage"], "identical": item["allEngineOutputsByteIdentical"]} for item in index["outputs"]]}))
