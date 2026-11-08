[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$archive = Join-Path $repoRoot 'native\jpeg-v2\vendor\libjpeg-turbo-3.1.4.1.tar.gz'
$expectedArchiveHash = 'ecae8008e2cc9ade2f2c1bb9d5e6d4fb73e7c433866a056bd82980741571a022'
$image = 'emscripten/emsdk@sha256:3a0d11e50f072dc2c4bc92e3b05ab1340fb7d4dd152f80b8af35fc1c6f15e644'

if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  throw 'The pinned libjpeg-turbo source archive is missing.'
}
$actualArchiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualArchiveHash -ne $expectedArchiveHash) {
  throw 'The pinned libjpeg-turbo source archive checksum does not match.'
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$taskRoot = Join-Path $repoRoot "tmp\jpeg-v2-repro-$stamp"
$buildA = Join-Path $taskRoot 'a'
$buildB = Join-Path $taskRoot 'b'
New-Item -ItemType Directory -Path $buildA, $buildB -Force | Out-Null

function Invoke-PinnedBuild([string]$buildPath) {
  $repoMount = "$repoRoot`:/src:ro"
  $buildMount = "$buildPath`:/work"
  & docker run --rm --network none `
    --mount "type=bind,source=$repoRoot,target=/src,readonly" `
    --mount "type=bind,source=$buildPath,target=/work" `
    $image sh /src/native/jpeg-v2/build-in-container.sh
  if ($LASTEXITCODE -ne 0) { throw 'Pinned JPEG v2 codec build failed.' }
}

Invoke-PinnedBuild $buildA
Invoke-PinnedBuild $buildB

$names = @('jpeg-v2-codec.mjs', 'jpeg-v2-codec.wasm')
foreach ($name in $names) {
  $first = Join-Path $buildA "output\$name"
  $second = Join-Path $buildB "output\$name"
  $firstHash = (Get-FileHash -LiteralPath $first -Algorithm SHA256).Hash
  $secondHash = (Get-FileHash -LiteralPath $second -Algorithm SHA256).Hash
  if ($firstHash -ne $secondHash) {
    throw "JPEG v2 codec rebuild mismatch for $name."
  }
}

$generatedDirectory = Join-Path $repoRoot 'src\features\steganography\jpeg-v2\generated'
$publicDirectory = Join-Path $repoRoot 'public\steg'
New-Item -ItemType Directory -Path $generatedDirectory, $publicDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $buildA 'output\jpeg-v2-codec.mjs') `
  -Destination (Join-Path $generatedDirectory 'jpeg-v2-codec.mjs') -Force
Copy-Item -LiteralPath (Join-Path $buildA 'output\jpeg-v2-codec.wasm') `
  -Destination (Join-Path $publicDirectory 'jpeg-v2-codec.wasm') -Force

Write-Host "Reproducible JPEG v2 codec outputs copied from $taskRoot"
