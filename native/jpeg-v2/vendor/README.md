# Pinned libjpeg-turbo source

`libjpeg-turbo-3.1.4.1.tar.gz` is the unmodified official source release used
to build the local JPEG v2 WebAssembly codec.

- Upstream: <https://github.com/libjpeg-turbo/libjpeg-turbo>
- Release: 3.1.4.1
- Archive SHA-256: `ecae8008e2cc9ade2f2c1bb9d5e6d4fb73e7c433866a056bd82980741571a022`
- License: IJG, modified BSD, and zlib licences; see `LICENSE.md`.

The normal application build never compiles this source and never downloads
anything. `scripts/build-jpeg-v2-codec.ps1` is the explicit regeneration path.
