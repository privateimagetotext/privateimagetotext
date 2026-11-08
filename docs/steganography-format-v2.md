# LocalText steganography format v2

Status: normative for LocalText `LTSG` version 2.

This document defines LocalText's coefficient-domain JPEG format. It is an
interoperability contract for the exact generated JPEG, not a claim of
losslessness, visual identity, anonymity, undetectability, steganalysis
resistance, metadata preservation, or survival through editing. Resizing,
pixel-domain decoding and re-encoding, screenshots, and quality recompression
are unsupported and may destroy the message. Version 1 PNG remains a separate,
permanently supported format.

All multibyte integers in this document are unsigned big-endian unless stated
otherwise. Implementations reject non-canonical values rather than guessing.

## Envelope and text rules

The header is exactly 84 bytes:

| Offset | Size | Field | Canonical v2 value |
|---:|---:|---|---|
| 0 | 4 | `magic` | ASCII `LTSG` |
| 4 | 1 | `version` | `2` |
| 5 | 1 | `flags` | `0` |
| 6 | 1 | `embeddingSuite` | `2` |
| 7 | 1 | `cryptoSuite` | `0` plain; `1` encrypted |
| 8 | 4 | `payloadLength` | exact embedded payload bytes |
| 12 | 4 | `iterations` | `0` plain; `600000` encrypted |
| 16 | 16 | `salt` | zero plain; fresh random encrypted |
| 32 | 12 | `nonce` | zero plain; fresh random encrypted |
| 44 | 32 | `digest` | SHA-256 plain; zero encrypted |
| 76 | 4 | `permutationStart` | affine traversal start |
| 80 | 4 | `permutationStep` | affine traversal step |

Message content is non-empty exact UTF-8, is not normalised, and is limited to
1,048,576 bytes. Unpaired UTF-16 surrogates are invalid. Decoding is fatal UTF-8.
Passwords are NFC-normalised without trimming and contain 12 through 256 Unicode
code points after normalisation.

Plain suite `0` embeds the exact UTF-8 bytes. `payloadLength` is 1 through
1,048,576, iterations/salt/nonce are zero, and `digest` is SHA-256 of the exact
payload. This detects accidental damage but is not malicious-tamper
authentication.

Encrypted suite `1` uses PBKDF2-HMAC-SHA-256 with exactly 600,000 iterations, a
fresh 16-byte salt, AES-256-GCM, a fresh 12-byte nonce, and a 128-bit tag.
`payload` is ciphertext followed by tag, `payloadLength` is plaintext length plus
16, and `digest` is zero. The exact complete v2 header is additional
authenticated data. Traversal fields are generated before encryption. There is
no passwordless verifier. Salt, nonce, start, and step use unbiased rejection
sampling backed by `crypto.getRandomValues`.

## Strict accepted JPEG profile

Inputs must be complete 8-bit Huffman JPEGs ending at EOI with no trailing
bytes. Only SOF0 baseline sequential and SOF2 progressive DCT are accepted.
There may be at most 128 progressive scans and bounded marker/fill-byte streams.
Arithmetic, lossless, differential, hierarchical, extended/high-precision,
12-bit, incomplete, and malformed JPEGs are rejected.

One-component input requires component identifier 1, 1x1 sampling, a valid
referenced 8-bit quantisation table, and no conflicting Adobe transform.
Three-component input requires identifiers 1,2,3 in that order and exactly one
of:

- 4:4:4: Y 1x1, Cb 1x1, Cr 1x1;
- 4:2:2: Y 2x1, Cb 1x1, Cr 1x1;
- 4:2:0: Y 2x2, Cb 1x1, Cr 1x1.

RGB-coded JPEG, CMYK, YCCK, 4:4:0, 4:1:1, scaled-equivalent noncanonical
sampling, unusual component order/count, and ambiguous colour interpretation
are rejected. A single structurally valid Adobe APP14 marker is accepted only
when transform 1 unambiguously denotes YCbCr. Duplicate, conflicting, RGB,
CMYK, and YCCK transforms are rejected.

Referenced quantisation tables must exist, use 8-bit precision, and contain
nonzero valid values. AC magnitudes may not exceed 1023. Every DC difference in
canonical output scan order must fit the baseline category with magnitude at
most 2047. A source that cannot be written canonically without changing an
unselected coefficient is rejected.

Source APP and COM segments are not copied. ICC is rejected. The only accepted
orientation state is absent or exactly one valid EXIF orientation 1 through 8;
malformed, duplicate, conflicting, or out-of-range orientation is rejected.
GPS, XMP, IPTC, comments, thumbnails, and unrelated metadata are discarded.

Limits are 25 MiB JPEG hide input, 80 MiB reveal input, 80 MiB generated output,
4096 by 4096 stored pixels, 1,048,576 plaintext bytes, 256 MiB WASM heap, and
128 progressive scans. All size, block, coefficient, group, bit, byte, and
allocation arithmetic is checked.

## Coefficient domain and eligibility

Only real luminance blocks are used. Let:

```text
luminanceBlockCount = width_in_blocks * height_in_blocks
N = luminanceBlockCount * 63
```

The component dimensions include partial edge blocks and exclude dummy MCU
padding blocks. `N` must fit the 32-bit traversal fields. Physical order is
block row, block column, then zigzag position 1 through 63. DC position 0 and all
chroma coefficients are excluded.

libjpeg coefficient arrays are natural 8x8 row-major arrays. Zigzag position to
natural index is:

```text
[0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,
 12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,
 35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,
 58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]
```

A luminance AC coefficient is eligible exactly when
`2 <= abs(coefficient) <= 1023`. Sign, DC, chroma, dummy blocks, ineligible
coefficients, and unselected coefficients never change.

## Matrix embedding

Eligible coefficients are grouped in sevens and carry three message bits. For
positions `i=1..7`, `carrierBit(i)=abs(coefficient[i]) & 1`. `syndrome` is the
XOR of indices whose bit is one. `desired` is the next three message bits,
MSB-first, as 0..7. `changeIndex = syndrome XOR desired`.

Zero changes nothing. Otherwise the selected magnitude toggles parity: even
becomes magnitude+1 and odd becomes magnitude-1; sign is preserved. Thus only
the pairs 2/3 through 1022/1023 are used and eligibility remains stable. At most
one coefficient changes per three bits. The final incomplete three-bit group is
zero-padded; `payloadLength` controls exact extraction. This is matrix coding,
not error correction.

Every write is checked for original/post eligibility, valid group index,
one-step magnitude change, sign preservation, no second group write, and bounded
change count.

## Header, traversal, and capacity

Header bytes and payload bytes are embedded MSB-first. The 672 header bits form
224 matrix groups and reserve the first 1,568 eligible coefficients in canonical
physical order. Only those 1,568 physical indices are retained for exclusion.

Payload traversal is over the complete physical domain, not a compact eligible
list:

```text
0 <= start < N
1 <= step < N
gcd(step, N) = 1
next = (current + step) mod N
```

Each visit skips ineligible and header-reserved positions. Remaining positions
fill seven-coefficient groups. Traversal stops after the declared bits or at
most `N` visits. No visited set is allocated.

```text
eligible = total eligible luminance AC coefficients
payloadGroups = max(0, floor((eligible - 1568) / 7))
physicalPayloadBytes = floor((payloadGroups * 3) / 8)
plainCapacity = min(1048576, physicalPayloadBytes)
encryptedCapacity = min(1048576, max(0, physicalPayloadBytes - 16))
```

Preflight and encoding use the same arithmetic.

## Canonical JPEG output

Output is SOF0, 8-bit, Huffman, nonprogressive, one canonical scan (grayscale or
interleaved YCbCr), restart interval zero, no Huffman optimisation, and standard
canonical Huffman tables. Encoded dimensions, quantisation tables, component
identifiers/order, sampling, and quantisation selectors match the source. Every
unselected real coefficient is unchanged.

Marker order is SOI; a newly generated JFIF APP0; optional minimal EXIF APP1;
normal structural tables/scan; EOI as the final bytes. JFIF payload bytes are:

```text
4a 46 49 46 00 01 01 00 00 01 00 01 00 00
```

This is JFIF 1.01, unit 0, density 1x1, no thumbnail. Orientation absent or 1
emits no EXIF. Orientation 2 through 8 emits one 32-byte big-endian EXIF payload:

```text
45 78 69 66 00 00 4d 4d 00 2a 00 00 00 08 00 01
01 12 00 03 00 00 00 01 00 OO 00 00 00 00 00 00
```

`OO` is the one-byte orientation value. No Adobe marker, source JFIF/EXIF, GPS,
XMP, IPTC, ICC, COM, thumbnail, unrelated APP marker, or trailing byte is emitted.
The operation is coefficient transcoding with selected mutations; it is not
called lossless.

## Reveal and error classification

With fewer than 77 eligible coefficients, reveal returns `no-message`. At 77 or
more, it recovers the first 32 bits; non-`LTSG` is `no-message`. Matching magic
with fewer than 1,568 eligible coefficients is `damaged`.

After a full header is available, validation order is version, flags, embedding
suite, crypto suite, canonical suite fields, traversal, and payload length
against physical capacity. Payload allocation and PBKDF2 occur only afterward.

- missing magic: `no-message`;
- unknown version: `unsupported-version`;
- unknown embedding or crypto suite: `unsupported-format`;
- recognised noncanonical v2, invalid plain digest, or invalid UTF-8: `damaged`;
- wrong password or authenticated header/ciphertext damage: `unlock-failed`.

No partial, guessed, replacement-decoded, or unauthenticated text is returned.

## Mandatory release-and-reopen verification

Encoding context A validates the source, embeds through guarded mutations,
computes an expected canonical-state digest, writes through an 80 MiB bounded
destination, and is destroyed. Only compressed output, the digest, and small
expected values remain. Fresh context B reopens the output, validates the
canonical profile, recomputes/compares the digest, extracts the exact header and
payload, and confirms dimensions, tables, components, sampling, and orientation.
TypeScript then verifies exact payload bytes/digest or authenticates/decrypts and
compares exact plaintext bytes. No Blob or download exists before success.

The digest representation starts with ASCII `LTV2VERIFY`, byte `1`, then bytes
for SOF0 (`c0`), precision 8, Huffman/nonprogressive, one scan, uint32 restart 0,
nonoptimised, JFIF major/minor 1/1, orientation or 0, uint32 width/height, and
component count. For each component it adds id, horizontal/vertical sampling,
quant-table selector, uint32 real block width/height. Referenced tables follow in
selector order as selector byte plus 64 uint16 natural-order values. Finally all
real coefficients follow by component, block-row/block-column, zigzag 0..63 as
two's-complement uint16. Integers are big-endian; there is no structure padding.

A mismatch is `jpeg-self-verification-failed`; all output is withheld and the
worker is terminated.

## Interoperability vectors and compatibility

Immutable independent coefficient vectors are in
`tests/fixtures/jpeg-v2/coefficient-vectors.json`; their generator and a separate
reference verifier do not import production embedding code. JPEG byte hashes are
only pinned-build integration evidence, not the normative format.

Version 2 is opt-in for Hide and automatically detected by JPEG signature for
Reveal. Version 1 PNG remains the default and is never reinterpreted or converted
to JPEG. Older clients that implement only v1 cannot reveal v2.
