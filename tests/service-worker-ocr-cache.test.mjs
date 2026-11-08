import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const { URL, Request, Response } = globalThis;
const source = await readFile("dist/sw.js", "utf8");
const manifest = JSON.parse(await readFile("src/config/ocr-languages.json", "utf8"));
const origin = "https://ocr.test";
const key = input => new URL(typeof input === "string" ? input : input.url, origin).pathname;
function harness() {
  const stores = new Map();
  const listeners = new Map();
  const requests = [];
  let offline = false;
  let corruptPath = "";
  const caches = { async open(name) {
    if (!stores.has(name)) {
      const entries = new Map();
      stores.set(name, {
        entries,
        async match(input) { return entries.get(key(input))?.clone(); },
        async put(input, response) { entries.set(key(input), response.clone()); },
        async delete(input) { return entries.delete(key(input)); },
      });
    }
    return stores.get(name);
  } };
  const fetch = async (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url, origin);
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, "error");
    requests.push(url.pathname);
    if (offline) throw new Error("offline");
    const bytes = await readFile(`public${url.pathname}`);
    if (url.pathname === corruptPath) bytes[100] ^= 1;
    return new Response(bytes);
  };
  const ctx = vm.createContext({ self: { location: { origin }, addEventListener(type, fn) { listeners.set(type, fn); } }, caches, fetch, crypto: webcrypto, URL, Request, Response });
  vm.runInContext(source, ctx);
  return {
    caches, requests,
    setOffline(value) { offline = value; },
    corruptNetwork(path) { corruptPath = path; },
    async message(data) {
      const replies = []; let pending;
      listeners.get("message")({ data, source: { postMessage: reply => replies.push(reply) }, waitUntil: work => { pending = work; } });
      await pending;
      return JSON.parse(JSON.stringify(replies));
    },
  };
}

test("OCR preparation caches only requested models; readiness follows verified bytes and eviction", async () => {
  const h = harness();
  await h.message({ type: "CHECK_OCR_CACHE" });
  assert.deepEqual(h.requests, []);
  const result = await h.message({ type: "PREPARE_OCR_CACHE", languages: ["spa", "hin"] });
  assert.deepEqual(result.at(-1).readyLanguages, ["spa", "hin"]);
  const paths = manifest.models.filter(model => ["spa", "hin"].includes(model.id)).map(model => model.path);
  assert.deepEqual(h.requests.filter(path => path.includes("/lang/")), paths);
  const cache = await h.caches.open("localtext-ocr-v5");
  await cache.delete(paths[1]);
  assert.deepEqual((await h.message({ type: "CHECK_OCR_CACHE" })).at(-1).readyLanguages, ["spa"]);
  h.setOffline(true);
  const before = h.requests.length;
  assert.equal((await h.message({ type: "PREPARE_OCR_CACHE", languages: ["spa"] })).at(-1).type, "OCR_CACHE_STATUS");
  assert.equal(h.requests.length, before);
  assert.equal((await h.message({ type: "PREPARE_OCR_CACHE", languages: ["hin"] })).at(-1).type, "OCR_CACHE_FAILED");
});

test("OCR rejects corrupt network and cached models, then repairs them online", async () => {
  const h = harness();
  const model = manifest.models.find(model => model.id === "tha");
  h.corruptNetwork(model.path);
  assert.equal((await h.message({ type: "PREPARE_OCR_CACHE", languages: ["tha"] })).at(-1).type, "OCR_CACHE_FAILED");
  const cache = await h.caches.open("localtext-ocr-v5");
  assert.equal(await cache.match(model.path), undefined);
  h.corruptNetwork("");
  await h.message({ type: "PREPARE_OCR_CACHE", languages: ["tha"] });
  const bytes = await readFile(`public${model.path}`); bytes[100] ^= 1;
  await cache.put(model.path, new Response(bytes));
  assert.deepEqual((await h.message({ type: "CHECK_OCR_CACHE" })).at(-1).readyLanguages, []);
  h.setOffline(true);
  assert.equal((await h.message({ type: "PREPARE_OCR_CACHE", languages: ["tha"] })).at(-1).type, "OCR_CACHE_FAILED");
  h.setOffline(false);
  assert.deepEqual((await h.message({ type: "PREPARE_OCR_CACHE", languages: ["tha"] })).at(-1).readyLanguages, ["tha"]);
});

test("OCR rejects unknown, duplicate, empty and excessive selections before any fetch", async () => {
  const h = harness();
  for (const languages of [[], ["chi_sim"], ["eng", "eng"], ["eng", "spa", "hin", "tha"]]) {
    assert.equal((await h.message({ type: "PREPARE_OCR_CACHE", languages })).at(-1).type, "OCR_CACHE_FAILED");
  }
  assert.deepEqual(h.requests, []);
});
