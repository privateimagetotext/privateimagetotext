#!/bin/sh
set -eu

mode=${1:-corpus}
iterations=${2:-5000}
archive=/src/native/jpeg-v2/vendor/libjpeg-turbo-3.1.4.1.tar.gz
fixture=/src/tests/fixtures/jpeg-v2/libjpeg-testorig.jpg
work_dir=$(mktemp -d)
source_dir=$work_dir/source
build_dir=$work_dir/build
compiler=/usr/bin/gcc

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

mkdir -p "$source_dir" "$build_dir"
tar -xzf "$archive" -C "$source_dir" --strip-components=1

sanitizer_flags='-O1 -g -fno-omit-frame-pointer -fsanitize=address,undefined -fno-sanitize-recover=all'
cmake -S "$source_dir" -B "$build_dir" -G 'Unix Makefiles' \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_C_COMPILER="$compiler" \
  -DCMAKE_C_FLAGS="$sanitizer_flags" \
  -DENABLE_SHARED=OFF \
  -DENABLE_STATIC=ON \
  -DWITH_ARITH_DEC=OFF \
  -DWITH_ARITH_ENC=OFF \
  -DWITH_JAVA=OFF \
  -DWITH_SIMD=OFF \
  -DWITH_TESTS=OFF \
  -DWITH_TOOLS=OFF \
  -DWITH_TURBOJPEG=OFF >/dev/null
cmake --build "$build_dir" --target jpeg-static --parallel 2 >/dev/null

"$compiler" \
  /src/native/jpeg-v2/wrapper/jpeg_v2_codec.c \
  /src/native/jpeg-v2/tests/jpeg_v2_security_test.c \
  "$build_dir/libjpeg.a" \
  -I"$build_dir" \
  -I"$source_dir/src" \
  $sanitizer_flags \
  -Wall -Wextra -Werror \
  -o "$work_dir/jpeg-v2-security-test"

export ASAN_OPTIONS='detect_leaks=1:halt_on_error=1:abort_on_error=1'
export UBSAN_OPTIONS='halt_on_error=1:print_stacktrace=1'

case "$mode" in
  corpus)
    "$work_dir/jpeg-v2-security-test" --corpus "$fixture"
    ;;
  fuzz)
    "$work_dir/jpeg-v2-security-test" --fuzz "$fixture" "$iterations"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
