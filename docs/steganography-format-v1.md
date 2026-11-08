# LocalText steganography format v1

Status: normative for LocalText `LTSG` version 1.

This document defines the only steganography format supported by LocalText v1. It is a binary interoperability contract, not a claim that steganography is undetectable. Implementations must reject non-canonical values rather than guessing.

## Raster and capacity model

The codec operates on a browser-decoded, unscaled RGBA raster. The output is a newly encoded PNG with the same decoded width and height. Source compression, metadata, colour profiles and translucent-pixel byte details are outside the format.

A pixel is eligible only when its alpha byte is exactly `255`. Each eligible pixel contributes one bit from each channel in `R`, `G`, `B` order. Alpha is never used. RGB bytes of pixels whose alpha is less than `255` are never used. Only the least-significant bit of an eligible RGB byte may change; its upper seven bits are preserved.

Let `opaquePixelCount` be the number of fully opaque pixels:

```text
eligibleBits          = opaquePixelCount * 3
headerBits            = 84 * 8 = 672
payloadBits           = eligibleBits - headerBits
embeddedByteCapacity  = floor(payloadBits / 8)
plainMessageCapacity  = min(1,048,576, embeddedByteCapacity)
encryptedMessageCapacity = min(1,048,576,
                               max(0, embeddedByteCapacity - 16))
```

All arithmetic must use safe non-negative integers. A raster with fewer than 672 eligible channels cannot contain a v1 header. Unused trailing bits are not capacity.

## Envelope

The header is exactly 84 bytes. All integers are unsigned and big-endian.

| Offset | Size | Field | Canonical v1 value |
|---:|---:|---|---|
| 0 | 4 | `magic` | ASCII `LTSG` (`4c 54 53 47`) |
| 4 | 1 | `version` | `1` |
| 5 | 1 | `flags` | `0`; every other value is rejected |
| 6 | 1 | `embeddingSuite` | `1` |
| 7 | 1 | `cryptoSuite` | `0` plain; `1` encrypted |
| 8 | 4 | `payloadLength` | exact bytes physically embedded after the header |
| 12 | 4 | `iterations` | `0` plain; `600000` encrypted |
| 16 | 16 | `salt` | zero plain; fresh random bytes encrypted |
| 32 | 12 | `nonce` | zero plain; fresh random bytes encrypted |
| 44 | 32 | `digest` | SHA-256 of the plain payload; zero encrypted |
| 76 | 4 | `permutationStart` | affine payload traversal start |
| 80 | 4 | `permutationStep` | affine payload traversal step |

The complete layout is:

```text
magic[4] | version[1] | flags[1] | embeddingSuite[1] | cryptoSuite[1]
| payloadLength[4] | iterations[4] | salt[16] | nonce[12]
| digest[32] | permutationStart[4] | permutationStep[4]
```

Header and payload bytes are embedded most-significant bit first. The 672 header bits use row-major pixels, fully opaque pixels only, channel order `R`, `G`, `B`. A decoder records the 672 physical RGB channel indices used by the header so the payload traversal can exclude them.

## Payloads and canonical fields

Messages are non-empty UTF-8 text and may contain at most 1,048,576 bytes. Message content is not normalised. A browser string containing an unpaired UTF-16 surrogate is invalid. Encoding uses `TextEncoder`; decoding uses a fatal UTF-8 decoder.

Plain suite `0`:

```text
payload        = exact message UTF-8 bytes
payloadLength  = message byte length (1..1,048,576)
iterations     = 0
salt           = 16 zero bytes
nonce          = 12 zero bytes
digest         = SHA-256(payload)
```

The digest detects accidental damage, but it is not malicious-tamper authentication because an attacker can replace both payload and digest.

Encrypted suite `1`:

```text
payload        = AES-GCM ciphertext followed by its 16-byte tag
payloadLength  = plaintext UTF-8 byte length + 16 (17..1,048,592)
iterations     = 600000 exactly
salt           = fresh 16-byte value
nonce          = fresh 12-byte value
digest         = 32 zero bytes
```

The encrypted digest is zero so the envelope does not provide a passwordless verifier for guessed plaintext.

## Password preparation and cryptographic suite 1

1. Reject unpaired UTF-16 surrogate code units.
2. Normalise the password to Unicode NFC.
3. Count Unicode code points after normalisation and require 12 through 256 inclusive.
4. Do not trim or otherwise alter the password.
5. UTF-8 encode the normalised string.

The exact password bytes are the PBKDF2 password input. Suite 1 is immutable:

```text
KDF:          PBKDF2-HMAC-SHA-256, exactly 600,000 iterations
Salt:         fresh 16 bytes
Derived key:  non-extractable AES-256 key, encrypt/decrypt usage only
Encryption:   AES-256-GCM, fresh 12-byte nonce, 128-bit tag
AAD:          exact complete 84-byte encoded header
```

The complete canonical header is encoded and validated before encryption. That exact header is additional authenticated data. Any authenticated header or ciphertext change therefore causes the same unlock failure as an incorrect password. Salt, nonce and permutation values are generated only with `crypto.getRandomValues`.

## Affine payload traversal

The permutation covers the complete physical RGB domain without allocating an eligible-channel index array:

```text
N          = width * height * 3
pixelIndex = floor(i / 3)
channel    = i mod 3          // 0 R, 1 G, 2 B
byteOffset = pixelIndex * 4 + channel

index0     = permutationStart
indexNext  = (indexCurrent + permutationStep) mod N
```

Canonical constraints are:

```text
0 <= permutationStart < N
1 <= permutationStep < N
gcd(permutationStep, N) = 1
```

A traversed slot carries a payload bit only when its pixel alpha is `255` and its physical channel index is not one of the recorded header channels. The traversal stops when all declared payload bits have been processed or after at most `N` slots. Coprimality guarantees uniqueness; no visited set is used.

Random starts and steps use unbiased rejection sampling. A candidate start is rejected when it is outside the largest multiple of `N` representable by the sampled unsigned 32-bit range. Step candidates use the same bounded sampling and are retried until they are in `1..N-1` and coprime to `N`. A naive modulo reduction is non-canonical generation behaviour, although decoders only validate the resulting values.

## Reveal validation order and result interpretation

Before payload allocation or password derivation, a decoder:

1. validates dimensions and safe arithmetic;
2. confirms 672 eligible header channels;
3. reads the header;
4. returns `no-message` when magic is absent;
5. validates version, then flags, embedding suite and crypto suite;
6. validates canonical iterations, salt, nonce and digest rules;
7. validates payload length against suite minimum, suite maximum, the 1 MiB message limit and image capacity;
8. validates start, step and coprimality;
9. allocates only the bounded payload and extracts it;
10. for plain mode, hashes, compares the digest and fatally decodes UTF-8;
11. for encrypted mode, requests a prepared password, derives the key, decrypts/authenticates and fatally decodes UTF-8.

Missing magic means `no-message`, not damage. An unknown version is `unsupported-version`; an unknown suite is `unsupported-format`. A recognised but non-canonical or corrupted v1 header/payload is `damaged`. Wrong passwords and authentication damage are intentionally indistinguishable as `unlock-failed`. No structural failure is permitted to trigger PBKDF2.

## Deterministic golden vectors

Hex strings are lowercase and contiguous. The vectors use a 32 by 16 fully opaque RGBA carrier, so `N = 1536`. Every carrier RGB byte begins as `a0` and every alpha byte as `ff`. They are codec vectors, not PNG byte-stream vectors.

The shared message is `Line 1`, LF, Greek small pi, and U+1F642. Its exact UTF-8 is:

```text
4c696e6520310acf80f09f9982
```

Its SHA-256 digest is:

```text
dbfcdce5f2a6467669326e2e77554ce14c5a3117b736c37625702a6b3e9b132a
```

### Plain vector

```text
payloadLength       = 13
permutationStart    = 677
permutationStep     = 5

header =
4c545347010001000000000d0000000000000000000000000000000000000000000000000000000000000000dbfcdce5f2a6467669326e2e77554ce14c5a3117b736c37625702a6b3e9b132a000002a500000005

payload =
4c696e6520310acf80f09f9982
```

The initial RGBA buffer SHA-256 is:

```text
287b84dbecfb81b83d5952cd80f25134b6370e13297cebff1c37b39a754a8f25
```

After sequential header and affine payload embedding, its RGBA SHA-256 is:

```text
f89db5db3ffa279ee7da0da573e4e256666e1203e569a033e45c948ad71c2073
```

Exactly 206 RGB bytes change from `a0` to `a1`; no alpha byte or upper seven RGB bits change. This hash is the published raw-RGBA golden and deliberately avoids depending on a browser PNG encoder.

### Encrypted vector

The password is the NFC string `p\u00e4ssphrase-012`. Deterministic salt and nonce are for testing only and must never replace fresh randomness in production:

```text
salt                = 000102030405060708090a0b0c0d0e0f
nonce               = a0a1a2a3a4a5a6a7a8a9aaab
iterations          = 600000
payloadLength       = 29
permutationStart    = 1001
permutationStep     = 5

header =
4c545347010001010000001d000927c0000102030405060708090a0b0c0d0e0fa0a1a2a3a4a5a6a7a8a9aaab0000000000000000000000000000000000000000000000000000000000000000000003e900000005

ciphertext-and-tag =
0fcf1426f648ccef238d88b2b7f96f282b196d99ae9af411e94bad109b
```

The deterministic encrypted RGBA SHA-256 is:

```text
7a57bac12c4074722f7cc452397e625530596a84f26f2dd6a3f7e322416d0150
```

Separate production operations with the same carrier, message and password must still produce fresh salt, nonce and permutation values and therefore randomised ciphertext and output.

## Compatibility boundary

LocalText supports only the exact format above. It does not promise compatibility with other steganography tools, survival through editing, cropping, screenshots, resizing or recompression, or preservation of source metadata. Future algorithms require a newly specified suite or envelope version; unknown values are never interpreted as v1.
