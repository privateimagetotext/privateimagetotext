# JPEG v2 native security checks

The native harness compiles the production wrapper and the pinned
libjpeg-turbo source with both AddressSanitizer and UndefinedBehaviorSanitizer
inside the same network-disabled, digest-pinned container used by the WASM
build. It uses only the checksum-pinned upstream libjpeg-turbo fixture.

From the repository root:

```powershell
pnpm run test:jpeg-native
pnpm run test:jpeg-fuzz
```

The first command runs a valid analyze/encode/fresh-inspect round trip, fixed
malformed cases and 512 deterministic mutations. The second runs 5,000 seeded
mutation iterations by default. An explicit bounded count can be supplied with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-jpeg-v2-native.ps1 -Mode fuzz -Iterations 10000
```

The build uses GCC 13.3.0 with
`-O1 -g -fno-omit-frame-pointer -fsanitize=address,undefined
-fno-sanitize-recover=all`; `ASAN_OPTIONS` enables leak detection and both
sanitizers halt on their first finding. This is a deterministic mutation smoke,
not a substitute for a longer coverage-guided fuzzing campaign.
