#!/bin/sh
set -eu

export SOURCE_DATE_EPOCH=1785628800
archive=/src/native/jpeg-v2/vendor/libjpeg-turbo-3.1.4.1.tar.gz
source_dir=/work/source
build_dir=/work/build
output_dir=/work/output

mkdir -p "$source_dir" "$build_dir" "$output_dir"
tar -xzf "$archive" -C "$source_dir" --strip-components=1

emcmake cmake -S "$source_dir" -B "$build_dir" -G 'Unix Makefiles' \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS_RELEASE='-O3 -DNDEBUG -ffile-prefix-map=/work=. -ffile-prefix-map=/src=.' \
  -DBUILD=20260802 \
  -DENABLE_SHARED=OFF \
  -DENABLE_STATIC=ON \
  -DWITH_ARITH_DEC=OFF \
  -DWITH_ARITH_ENC=OFF \
  -DWITH_JAVA=OFF \
  -DWITH_SIMD=OFF \
  -DWITH_TESTS=OFF \
  -DWITH_TOOLS=OFF \
  -DWITH_TURBOJPEG=OFF

cmake --build "$build_dir" --target jpeg-static

emcc /src/native/jpeg-v2/wrapper/jpeg_v2_codec.c "$build_dir/libjpeg.a" \
  -I"$build_dir" \
  -I"$source_dir/src" \
  -O3 \
  -DNDEBUG \
  -Wall \
  -Wextra \
  -Werror \
  -ffile-prefix-map=/work=. \
  -ffile-prefix-map=/src=. \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=worker \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=16777216 \
  -sMAXIMUM_MEMORY=268435456 \
  -sABORTING_MALLOC=0 \
  -sFILESYSTEM=0 \
  -sSUPPORT_LONGJMP=emscripten \
  -sMALLOC=emmalloc \
  -sASSERTIONS=0 \
  -sSTACK_SIZE=524288 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_jpegv2_analyze","_jpegv2_encode","_jpegv2_inspect","_jpegv2_reset","_jpegv2_output_ptr","_jpegv2_output_length","_jpegv2_header_ptr","_jpegv2_payload_ptr","_jpegv2_payload_length","_jpegv2_info_value"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -sINCOMING_MODULE_JS_API='["locateFile","instantiateWasm","onAbort"]' \
  -o "$output_dir/jpeg-v2-codec.mjs"
