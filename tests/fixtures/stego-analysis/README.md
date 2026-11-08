# Steganography analysis fixtures

Synthetic CTF-style images for `tests/unit/stego-analysis.test.ts` and
`e2e/stego-analysis.spec.ts`. They contain no real data. Regenerate them
deterministically with:

```sh
node --experimental-strip-types tests/fixtures/stego-analysis/generate.ts
```

| File | Hidden data | Setting that reveals it | zsteg equivalent |
| --- | --- | --- | --- |
| `lsb-rgb-rows.png` | `flag{rgb_rows_msb_first}` | R, G, B · bit 0 · rows · MSB-first | `b1,rgb,lsb,xy` |
| `lsb-bgr-columns-lsb-first.png` | `flag{bgr_columns_lsb_first}` | B, G, R order · R, G, B · bit 0 · columns · LSB-first | `b1,bgr,msb,yx` |
| `lsb-green-two-bits.png` | `flag{green_bits_1_and_0}` | G · bits 1 and 0 · rows · MSB-first | `b2,g,lsb,xy` |
| `lsb-abgr-bottom-up.png` | `flag{abgr_from_the_bottom}` | A, B, G, R order · all four channels · bit 0 · rows from the bottom · MSB-first | `b1,abgr,lsb,xY` |
| `lsb-16bit-low-byte.png` | `flag{sixteen_bit_lsb}` (16-bit RGB) | 16-bit samples: Low byte · R, G, B · bit 0 · rows · MSB-first | `b1,rgb,lsb,xy` |
| `plane-blue-5.png` | The word FLAG drawn in pixels | Bit planes → Blue plane 5 | — |
| `trailing-zip.png` | Stored ZIP containing `flag.txt` = `flag{zip_after_iend}` | File bytes → Data after the end of the image | — |
| `trailing-text.jpg` | `flag{text_after_eoi}` after the JPEG EOI marker | File bytes → Data after the end of the image | — |

The zsteg column follows zsteg's own source (`color_extractor.rb`): its default
`lsb` bit order puts the first extracted bit in the byte's most significant
position, and `msb` puts it in the least significant position.

`trailing-text.jpg` appends bytes to `tests/fixtures/jpeg-v2/libjpeg-testorig.jpg`
(see that folder for its licence notice).
