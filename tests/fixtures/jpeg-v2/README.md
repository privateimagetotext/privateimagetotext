# JPEG v2 fixture provenance

`libjpeg-testorig.jpg` is the 5,770-byte `testimages/testorig.jpg` fixture from the
vendored official libjpeg-turbo 3.1.4.1 source archive. It is covered by the
upstream licence at `native/jpeg-v2/vendor/LICENSE.md`.

Reproduce it from the repository root with:

```powershell
$extractRoot = Join-Path $env:TEMP 'localtext-libjpeg-fixture'
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
tar -xf native/jpeg-v2/vendor/libjpeg-turbo-3.1.4.1.tar.gz -C $extractRoot libjpeg-turbo-3.1.4.1/testimages/testorig.jpg
Copy-Item -LiteralPath (Join-Path $extractRoot 'libjpeg-turbo-3.1.4.1\testimages\testorig.jpg') -Destination tests/fixtures/jpeg-v2/libjpeg-testorig.jpg -Force
```

SHA-256: `acc6ec555d41d15b368320edaa3b20958ee6fa97cb6e4a18d1213d5ae8bec73b`

No personal or user-supplied image is used by the JPEG v2 tests.
