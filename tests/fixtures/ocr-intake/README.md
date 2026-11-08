# Synthetic OCR intake fixtures

These complete, decodable 720 by 180 pixel images contain only the invented text
`LOCAL OCR INTAKE 7429` and `SYNTHETIC TEST IMAGE`. They contain no user documents
or personal information. Each format encodes the same white background and black
Arial 40 pixel text at `(24, 26)` and `(24, 90)`.

Generated locally with Pillow 12.3.0: `Image.new("RGB", (720, 180), "white")`,
`ImageDraw.text`, and `ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 40)`.
PNG and BMP use default encoding, JPEG uses quality 95, and WebP uses lossless
encoding. Pillow reopened and fully decoded every saved file.

The unit tests use these complete files to distinguish MIME handling from
header-only synthetic boundary tests. The browser tests run the normal OCR intake
and decode path with absent, generic, matching and contradictory MIME metadata.
