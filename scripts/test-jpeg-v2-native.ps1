[CmdletBinding()]
param(
  [ValidateSet('corpus', 'fuzz')]
  [string]$Mode = 'corpus',
  [ValidateRange(1, 1000000)]
  [int]$Iterations = 5000
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixture = Join-Path $repoRoot 'tests\fixtures\jpeg-v2\libjpeg-testorig.jpg'
$expectedFixtureHash = 'acc6ec555d41d15b368320edaa3b20958ee6fa97cb6e4a18d1213d5ae8bec73b'
$image = 'emscripten/emsdk@sha256:3a0d11e50f072dc2c4bc92e3b05ab1340fb7d4dd152f80b8af35fc1c6f15e644'

if (-not (Test-Path -LiteralPath $fixture -PathType Leaf)) {
  throw 'The pinned native security-test fixture is missing.'
}
$actualFixtureHash = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualFixtureHash -ne $expectedFixtureHash) {
  throw 'The native security-test fixture checksum does not match.'
}

& docker run --rm --network none `
  --mount "type=bind,source=$repoRoot,target=/src,readonly" `
  $image sh /src/native/jpeg-v2/test-in-container.sh $Mode $Iterations
if ($LASTEXITCODE -ne 0) {
  throw "JPEG v2 native $Mode test failed."
}
