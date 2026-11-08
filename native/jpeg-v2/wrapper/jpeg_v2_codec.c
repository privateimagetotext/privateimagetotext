#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif
#include <limits.h>
#include <setjmp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <jerror.h>
#include <jpeglib.h>

#ifndef JPEG_V2_MAX_OUTPUT
#define JPEG_V2_MAX_OUTPUT (80u * 1024u * 1024u)
#endif
#ifdef __EMSCRIPTEN__
typedef uint32_t jpegv2_pointer;
#else
typedef uintptr_t jpegv2_pointer;
#endif
#define JPEG_V2_MAX_MARKERS 4096u
#define JPEG_V2_MAX_FILL_BYTES 65536u
#define JPEG_V2_MAX_SCANS 128u
#define JPEG_V2_MAX_HIDE_INPUT (25u * 1024u * 1024u)
#define JPEG_V2_MAX_REVEAL_INPUT (80u * 1024u * 1024u)
#define JPEG_V2_MAX_DIMENSION 4096u
#define JPEG_V2_HEADER_BYTES 84u
#define JPEG_V2_HEADER_BITS (JPEG_V2_HEADER_BYTES * 8u)
#define JPEG_V2_HEADER_GROUPS 224u
#define JPEG_V2_HEADER_COEFFICIENTS 1568u
#define JPEG_V2_MAX_PAYLOAD (1024u * 1024u + 16u)
#define MARKER_SOF0 0xc0u
#define MARKER_SOF2 0xc2u
#define MARKER_DQT 0xdbu
#define MARKER_SOI 0xd8u
#define MARKER_EOI 0xd9u
#define MARKER_SOS 0xdau
#define MARKER_DAC 0xccu

enum jpeg_v2_status {
  JPEG_V2_OK = 0,
  JPEG_V2_MALFORMED = 1,
  JPEG_V2_UNSUPPORTED_PROFILE = 2,
  JPEG_V2_ALLOCATION_FAILED = 3,
  JPEG_V2_OUTPUT_TOO_LARGE = 4,
  JPEG_V2_CAPACITY = 5,
  JPEG_V2_NO_MESSAGE = 6,
  JPEG_V2_UNSUPPORTED_VERSION = 7,
  JPEG_V2_UNSUPPORTED_FORMAT = 8,
  JPEG_V2_DAMAGED = 9,
  JPEG_V2_SELF_VERIFY_FAILED = 10,
  JPEG_V2_INVALID_ARGUMENT = 11
};

typedef struct {
  struct jpeg_error_mgr pub;
  jmp_buf jump;
  int status;
} gate_error_mgr;

typedef struct {
  struct jpeg_destination_mgr pub;
  JOCTET *buffer;
  size_t capacity;
  size_t length;
  size_t limit;
  gate_error_mgr *error;
} bounded_destination;

typedef struct {
  struct jpeg_compress_struct compressor;
  gate_error_mgr error;
  bounded_destination destination;
  int compressor_created;
} serialization_context;

typedef struct {
  struct jpeg_decompress_struct decoder;
  gate_error_mgr error;
  jvirt_barray_ptr *coefficients;
  uint32_t scan_count;
  uint8_t orientation;
} gate_source;

typedef struct {
  uint32_t width;
  uint32_t height;
  uint32_t components;
  uint32_t progressive;
  uint32_t sampling;
  uint32_t luminance_blocks_wide;
  uint32_t luminance_blocks_high;
  uint32_t physical_domain_size;
  uint32_t eligible_coefficients;
  uint32_t payload_byte_capacity;
  uint32_t orientation;
} gate_info;

static const uint8_t zigzag_to_natural[64] = {
    0,  1,  8,  16, 9,  2,  3,  10, 17, 24, 32, 25, 18, 11, 4,  5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6,  7,  14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63};

static const uint8_t canonical_jfif[14] = {
    'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0};

static void canonical_exif(uint8_t output[32], uint8_t orientation) {
  static const uint8_t template_bytes[32] = {
      'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1,
      0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0};
  memcpy(output, template_bytes, sizeof(template_bytes));
  output[25] = orientation;
}

static gate_info last_info;
static uint8_t *last_output;
static uint32_t last_output_length;
static uint8_t *last_header;
static uint8_t *last_payload;
static uint32_t last_payload_length;

typedef struct {
  uint32_t state[8];
  uint64_t total_bytes;
  uint8_t block[64];
  uint32_t block_length;
} jpeg_v2_sha256;

static const uint32_t sha256_constants[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};

static uint32_t rotate_right(uint32_t value, uint32_t count) {
  return (value >> count) | (value << (32u - count));
}

static void sha256_transform(jpeg_v2_sha256 *context,
                             const uint8_t block[64]) {
  uint32_t words[64];
  uint32_t a, b, c, d, e, f, g, h;
  uint32_t index;
  for (index = 0; index < 16; index++) {
    const uint8_t *word = block + index * 4u;
    words[index] = ((uint32_t)word[0] << 24) | ((uint32_t)word[1] << 16) |
                   ((uint32_t)word[2] << 8) | word[3];
  }
  for (index = 16; index < 64; index++) {
    uint32_t s0 = rotate_right(words[index - 15], 7) ^
                  rotate_right(words[index - 15], 18) ^
                  (words[index - 15] >> 3);
    uint32_t s1 = rotate_right(words[index - 2], 17) ^
                  rotate_right(words[index - 2], 19) ^
                  (words[index - 2] >> 10);
    words[index] = words[index - 16] + s0 + words[index - 7] + s1;
  }
  a = context->state[0]; b = context->state[1];
  c = context->state[2]; d = context->state[3];
  e = context->state[4]; f = context->state[5];
  g = context->state[6]; h = context->state[7];
  for (index = 0; index < 64; index++) {
    uint32_t sum1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^
                    rotate_right(e, 25);
    uint32_t choose = (e & f) ^ ((~e) & g);
    uint32_t temporary1 = h + sum1 + choose + sha256_constants[index] +
                          words[index];
    uint32_t sum0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^
                    rotate_right(a, 22);
    uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    uint32_t temporary2 = sum0 + majority;
    h = g; g = f; f = e; e = d + temporary1;
    d = c; c = b; b = a; a = temporary1 + temporary2;
  }
  context->state[0] += a; context->state[1] += b;
  context->state[2] += c; context->state[3] += d;
  context->state[4] += e; context->state[5] += f;
  context->state[6] += g; context->state[7] += h;
  memset(words, 0, sizeof(words));
}

static void sha256_init(jpeg_v2_sha256 *context) {
  static const uint32_t initial[8] = {
      0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
      0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
  memset(context, 0, sizeof(*context));
  memcpy(context->state, initial, sizeof(initial));
}

static void sha256_update(jpeg_v2_sha256 *context, const uint8_t *bytes,
                          size_t length) {
  size_t offset = 0;
  context->total_bytes += length;
  while (offset < length) {
    size_t available = 64u - context->block_length;
    size_t count = length - offset < available ? length - offset : available;
    memcpy(context->block + context->block_length, bytes + offset, count);
    context->block_length += (uint32_t)count;
    offset += count;
    if (context->block_length == 64u) {
      sha256_transform(context, context->block);
      context->block_length = 0;
    }
  }
}

static void sha256_final(jpeg_v2_sha256 *context, uint8_t digest[32]) {
  uint64_t bits = context->total_bytes * 8u;
  uint8_t padding[128];
  size_t padding_length;
  uint32_t index;
  memset(padding, 0, sizeof(padding));
  padding[0] = 0x80u;
  padding_length = context->block_length < 56u
                       ? 56u - context->block_length
                       : 120u - context->block_length;
  sha256_update(context, padding, padding_length);
  for (index = 0; index < 8; index++)
    padding[index] = (uint8_t)(bits >> (56u - index * 8u));
  sha256_update(context, padding, 8u);
  for (index = 0; index < 8; index++) {
    digest[index * 4u] = (uint8_t)(context->state[index] >> 24);
    digest[index * 4u + 1u] = (uint8_t)(context->state[index] >> 16);
    digest[index * 4u + 2u] = (uint8_t)(context->state[index] >> 8);
    digest[index * 4u + 3u] = (uint8_t)context->state[index];
  }
  memset(context, 0, sizeof(*context));
  memset(padding, 0, sizeof(padding));
}

static void reset_results(void) {
  if (last_output != NULL) {
    memset(last_output, 0, last_output_length);
    free(last_output);
  }
  if (last_header != NULL) {
    memset(last_header, 0, JPEG_V2_HEADER_BYTES);
    free(last_header);
  }
  if (last_payload != NULL) {
    memset(last_payload, 0, last_payload_length);
    free(last_payload);
  }
  last_output = NULL;
  last_output_length = 0;
  last_header = NULL;
  last_payload = NULL;
  last_payload_length = 0;
  memset(&last_info, 0, sizeof(last_info));
}

static void gate_error_exit(j_common_ptr common) {
  gate_error_mgr *error = (gate_error_mgr *)common->err;
  if (error->status == JPEG_V2_OK) error->status = JPEG_V2_MALFORMED;
  longjmp(error->jump, 1);
}

static void gate_emit_message(j_common_ptr common, int level) {
  if (level < 0) gate_error_exit(common);
}

static void init_error(gate_error_mgr *error) {
  memset(error, 0, sizeof(*error));
  jpeg_std_error(&error->pub);
  error->pub.error_exit = gate_error_exit;
  error->pub.emit_message = gate_emit_message;
  error->status = JPEG_V2_OK;
}

static int checked_add_size(size_t left, size_t right, size_t *result) {
  if (left > SIZE_MAX - right) return 0;
  *result = left + right;
  return 1;
}

static int checked_mul_u32(uint32_t left, uint32_t right, uint32_t *result) {
  uint64_t value = (uint64_t)left * (uint64_t)right;
  if (value > UINT32_MAX) return 0;
  *result = (uint32_t)value;
  return 1;
}

static int marker_has_length(uint8_t marker) {
  return marker != MARKER_SOI && marker != MARKER_EOI && marker != 0x01 &&
         !(marker >= JPEG_RST0 && marker <= JPEG_RST0 + 7);
}

static int is_sof_marker(uint8_t marker) {
  return marker >= 0xc0u && marker <= 0xcfu && marker != 0xc4u &&
         marker != 0xc8u && marker != 0xccu;
}

static uint16_t read_u16_endian(const uint8_t *bytes, int little_endian) {
  return little_endian
             ? (uint16_t)((uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8))
             : (uint16_t)(((uint16_t)bytes[0] << 8) | bytes[1]);
}

static uint32_t read_u32_endian(const uint8_t *bytes, int little_endian) {
  if (little_endian)
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
  return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
         ((uint32_t)bytes[2] << 8) | bytes[3];
}

static int parse_exif_orientation(const uint8_t *payload, size_t length,
                                  uint8_t *orientation, int *found) {
  const uint8_t *tiff;
  size_t tiff_length;
  uint32_t ifd_offset;
  uint16_t count;
  uint16_t index;
  int little_endian;
  int orientation_seen = 0;
  if (length < 6 || memcmp(payload, "Exif\0\0", 6) != 0) return JPEG_V2_OK;
  if (*found) return JPEG_V2_MALFORMED;
  *found = 1;
  tiff = payload + 6;
  tiff_length = length - 6;
  if (tiff_length < 14) return JPEG_V2_MALFORMED;
  if (tiff[0] == 'I' && tiff[1] == 'I')
    little_endian = 1;
  else if (tiff[0] == 'M' && tiff[1] == 'M')
    little_endian = 0;
  else
    return JPEG_V2_MALFORMED;
  if (read_u16_endian(tiff + 2, little_endian) != 42)
    return JPEG_V2_MALFORMED;
  ifd_offset = read_u32_endian(tiff + 4, little_endian);
  if (ifd_offset > tiff_length - 2u) return JPEG_V2_MALFORMED;
  count = read_u16_endian(tiff + ifd_offset, little_endian);
  if ((size_t)count > (tiff_length - ifd_offset - 2u) / 12u)
    return JPEG_V2_MALFORMED;
  for (index = 0; index < count; index++) {
    const uint8_t *entry = tiff + ifd_offset + 2u + (size_t)index * 12u;
    if (read_u16_endian(entry, little_endian) == 0x0112u) {
      uint16_t value;
      if (orientation_seen ||
          read_u16_endian(entry + 2, little_endian) != 3u ||
          read_u32_endian(entry + 4, little_endian) != 1u)
        return JPEG_V2_MALFORMED;
      orientation_seen = 1;
      value = read_u16_endian(entry + 8, little_endian);
      if (value < 1u || value > 8u) return JPEG_V2_MALFORMED;
      *orientation = (uint8_t)value;
    }
  }
  return JPEG_V2_OK;
}

static int scan_complete_jpeg(const uint8_t *input, size_t length,
                              uint32_t *scan_count, uint8_t *frame_marker,
                              uint8_t *orientation) {
  size_t position = 0;
  uint32_t markers = 0;
  uint32_t fills = 0;
  int entropy = 0;
  int exif_found = 0;
  int adobe_found = 0;
  if (input == NULL || length < 4 || input[0] != 0xff || input[1] != MARKER_SOI)
    return JPEG_V2_MALFORMED;
  position = 2;
  *scan_count = 0;
  *frame_marker = 0;
  *orientation = 1;
  while (position < length) {
    uint8_t marker;
    if (!entropy) {
      if (input[position++] != 0xff) return JPEG_V2_MALFORMED;
    } else {
      while (position < length && input[position] != 0xff) position++;
      if (position == length) return JPEG_V2_MALFORMED;
      position++;
    }
    while (position < length && input[position] == 0xff) {
      if (++fills > JPEG_V2_MAX_FILL_BYTES) return JPEG_V2_MALFORMED;
      position++;
    }
    if (position == length) return JPEG_V2_MALFORMED;
    marker = input[position++];
    if (entropy && marker == 0x00) continue;
    if (entropy && marker >= JPEG_RST0 && marker <= JPEG_RST0 + 7) continue;
    entropy = 0;
    if (++markers > JPEG_V2_MAX_MARKERS) return JPEG_V2_MALFORMED;
    if (marker == MARKER_EOI) return position == length && *frame_marker != 0
                                         ? JPEG_V2_OK
                                         : JPEG_V2_MALFORMED;
    if (marker == MARKER_SOI || marker == 0x00 || !marker_has_length(marker))
      return JPEG_V2_MALFORMED;
    if (marker == MARKER_DAC) return JPEG_V2_UNSUPPORTED_PROFILE;
    if (is_sof_marker(marker)) {
      if (*frame_marker != 0) return JPEG_V2_MALFORMED;
      if (marker != MARKER_SOF0 && marker != MARKER_SOF2)
        return JPEG_V2_UNSUPPORTED_PROFILE;
      *frame_marker = marker;
    }
    if (position + 2 > length) return JPEG_V2_MALFORMED;
    {
      uint16_t segment_length =
          (uint16_t)(((uint16_t)input[position] << 8) | input[position + 1]);
      size_t segment_end;
      if (segment_length < 2 ||
          !checked_add_size(position, segment_length, &segment_end) ||
          segment_end > length)
        return JPEG_V2_MALFORMED;
      if (marker == JPEG_APP0 + 2 && segment_length >= 14 &&
          memcmp(input + position + 2, "ICC_PROFILE\0", 12) == 0)
        return JPEG_V2_UNSUPPORTED_PROFILE;
      if (marker == JPEG_APP0 + 1) {
        int exif_status = parse_exif_orientation(
            input + position + 2, segment_length - 2u, orientation, &exif_found);
        if (exif_status != JPEG_V2_OK) return exif_status;
      }
      if (marker == JPEG_APP0 + 14) {
        const uint8_t *payload = input + position + 2;
        size_t payload_length = segment_length - 2u;
        if (adobe_found || payload_length != 12u ||
            memcmp(payload, "Adobe", 5) != 0 || payload[11] != 1u)
          return JPEG_V2_UNSUPPORTED_PROFILE;
        adobe_found = 1;
      }
      if (marker == MARKER_DQT) {
        size_t cursor = position + 2;
        while (cursor < segment_end) {
          uint8_t precision;
          size_t table_bytes;
          precision = input[cursor] >> 4;
          if (precision != 0) return JPEG_V2_UNSUPPORTED_PROFILE;
          table_bytes = 1u + 64u;
          if (cursor > segment_end - table_bytes) return JPEG_V2_MALFORMED;
          cursor += table_bytes;
        }
      }
      position = segment_end;
    }
    if (marker == MARKER_SOS) {
      if (++(*scan_count) > JPEG_V2_MAX_SCANS)
        return JPEG_V2_UNSUPPORTED_PROFILE;
      entropy = 1;
    }
  }
  return JPEG_V2_MALFORMED;
}

static int validate_canonical_markers(const uint8_t *input, size_t length,
                                      uint8_t expected_orientation) {
  static const uint8_t color_dht_digest[32] = {
      0xf3, 0x61, 0xab, 0x42, 0xf7, 0x1f, 0xf0, 0x19,
      0x27, 0x5c, 0x52, 0x24, 0x94, 0xac, 0xce, 0xdf,
      0x9f, 0xad, 0xd1, 0x3f, 0x16, 0xaf, 0x71, 0x63,
      0x2c, 0xa2, 0x82, 0x55, 0xa7, 0x55, 0x4a, 0x15};
  static const uint8_t gray_dht_digest[32] = {
      0xa8, 0x11, 0xc2, 0x96, 0x54, 0x54, 0xc7, 0x69,
      0xa4, 0x16, 0x47, 0x60, 0x88, 0xdf, 0x6e, 0x55,
      0x00, 0x17, 0x19, 0xc0, 0x57, 0x42, 0x20, 0x9a,
      0xb5, 0x8b, 0x75, 0xb8, 0x22, 0x15, 0xc2, 0x5e};
  size_t position = 2u;
  uint32_t marker_index = 0;
  uint32_t dqt_count = 0;
  uint32_t dht_count = 0;
  uint8_t components = 0;
  int saw_sof = 0;
  int saw_sos = 0;
  jpeg_v2_sha256 dht_hash;
  uint8_t actual_dht_digest[32];
  if (length < 4u || input[0] != 0xffu || input[1] != MARKER_SOI)
    return JPEG_V2_SELF_VERIFY_FAILED;
  sha256_init(&dht_hash);
  while (position < length && !saw_sos) {
    uint8_t marker;
    uint16_t segment_length;
    size_t segment_end;
    const uint8_t *payload;
    size_t payload_length;
    if (input[position++] != 0xffu || position >= length ||
        input[position] == 0xffu)
      return JPEG_V2_SELF_VERIFY_FAILED;
    marker = input[position++];
    if (!marker_has_length(marker) || position + 2u > length)
      return JPEG_V2_SELF_VERIFY_FAILED;
    segment_length = (uint16_t)(((uint16_t)input[position] << 8) |
                                input[position + 1u]);
    if (segment_length < 2u ||
        !checked_add_size(position, segment_length, &segment_end) ||
        segment_end > length)
      return JPEG_V2_SELF_VERIFY_FAILED;
    payload = input + position + 2u;
    payload_length = segment_length - 2u;
    if (marker_index == 0u) {
      if (marker != JPEG_APP0 || payload_length != sizeof(canonical_jfif) ||
          memcmp(payload, canonical_jfif, sizeof(canonical_jfif)) != 0)
        return JPEG_V2_SELF_VERIFY_FAILED;
    } else if (marker_index == 1u && expected_orientation >= 2u) {
      uint8_t expected_exif[32];
      canonical_exif(expected_exif, expected_orientation);
      if (marker != JPEG_APP0 + 1 || payload_length != sizeof(expected_exif) ||
          memcmp(payload, expected_exif, sizeof(expected_exif)) != 0)
        return JPEG_V2_SELF_VERIFY_FAILED;
    } else if (marker == MARKER_DQT && !saw_sof && dht_count == 0u) {
      dqt_count++;
    } else if (marker == MARKER_SOF0 && !saw_sof && dqt_count > 0u &&
               payload_length >= 6u) {
      components = payload[5];
      if ((components != 1u && components != 3u) ||
          payload_length != (size_t)(6u + 3u * components) || payload[0] != 8u)
        return JPEG_V2_SELF_VERIFY_FAILED;
      saw_sof = 1;
    } else if (marker == 0xc4u && saw_sof && !saw_sos) {
      sha256_update(&dht_hash, payload, payload_length);
      dht_count++;
    } else if (marker == MARKER_SOS && saw_sof &&
               dht_count == (components == 1u ? 2u : 4u)) {
      uint8_t index;
      if (payload_length != (size_t)(4u + 2u * components) ||
          payload[0] != components || payload[payload_length - 3u] != 0u ||
          payload[payload_length - 2u] != 63u ||
          payload[payload_length - 1u] != 0u)
        return JPEG_V2_SELF_VERIFY_FAILED;
      for (index = 0; index < components; index++) {
        uint8_t expected_tables = index == 0u ? 0x00u : 0x11u;
        if (payload[1u + index * 2u] != index + 1u ||
            payload[2u + index * 2u] != expected_tables)
          return JPEG_V2_SELF_VERIFY_FAILED;
      }
      saw_sos = 1;
    } else {
      return JPEG_V2_SELF_VERIFY_FAILED;
    }
    marker_index++;
    position = segment_end;
  }
  if (!saw_sos) return JPEG_V2_SELF_VERIFY_FAILED;
  sha256_final(&dht_hash, actual_dht_digest);
  if (memcmp(actual_dht_digest,
             components == 1u ? gray_dht_digest : color_dht_digest,
             sizeof(actual_dht_digest)) != 0)
    return JPEG_V2_SELF_VERIFY_FAILED;
  while (position < length) {
    if (input[position++] != 0xffu) continue;
    if (position >= length) return JPEG_V2_SELF_VERIFY_FAILED;
    if (input[position] == 0x00u) {
      position++;
      continue;
    }
    if (input[position++] != MARKER_EOI || position != length)
      return JPEG_V2_SELF_VERIFY_FAILED;
    return JPEG_V2_OK;
  }
  return JPEG_V2_SELF_VERIFY_FAILED;
}

static int validate_profile(struct jpeg_decompress_struct *decoder) {
  int component;
  if (decoder->data_precision != 8 || decoder->arith_code ||
      decoder->image_width == 0 || decoder->image_height == 0 ||
      decoder->image_width > JPEG_V2_MAX_DIMENSION ||
      decoder->image_height > JPEG_V2_MAX_DIMENSION)
    return JPEG_V2_UNSUPPORTED_PROFILE;
  if (decoder->num_components == 1) {
    jpeg_component_info *gray = &decoder->comp_info[0];
    if (gray->component_id != 1 || gray->h_samp_factor != 1 ||
        gray->v_samp_factor != 1 || decoder->saw_Adobe_marker ||
        decoder->jpeg_color_space != JCS_GRAYSCALE ||
        gray->quant_tbl_no < 0 || gray->quant_tbl_no >= NUM_QUANT_TBLS ||
        decoder->quant_tbl_ptrs[gray->quant_tbl_no] == NULL)
      return JPEG_V2_UNSUPPORTED_PROFILE;
  } else {
    if (decoder->num_components != 3 ||
        decoder->jpeg_color_space != JCS_YCbCr)
      return JPEG_V2_UNSUPPORTED_PROFILE;
    if (decoder->comp_info[0].component_id != 1 ||
        decoder->comp_info[1].component_id != 2 ||
        decoder->comp_info[2].component_id != 3)
      return JPEG_V2_UNSUPPORTED_PROFILE;
    if (decoder->saw_Adobe_marker && decoder->Adobe_transform != 1)
      return JPEG_V2_UNSUPPORTED_PROFILE;
    if (decoder->comp_info[1].h_samp_factor != 1 ||
        decoder->comp_info[1].v_samp_factor != 1 ||
        decoder->comp_info[2].h_samp_factor != 1 ||
        decoder->comp_info[2].v_samp_factor != 1)
      return JPEG_V2_UNSUPPORTED_PROFILE;
    if (!((decoder->comp_info[0].h_samp_factor == 1 &&
           decoder->comp_info[0].v_samp_factor == 1) ||
          (decoder->comp_info[0].h_samp_factor == 2 &&
           decoder->comp_info[0].v_samp_factor == 1) ||
          (decoder->comp_info[0].h_samp_factor == 2 &&
           decoder->comp_info[0].v_samp_factor == 2)))
      return JPEG_V2_UNSUPPORTED_PROFILE;
  }
  for (component = 0; component < decoder->num_components; component++) {
    int table = decoder->comp_info[component].quant_tbl_no;
    int index;
    if (table < 0 || table >= NUM_QUANT_TBLS ||
        decoder->quant_tbl_ptrs[table] == NULL)
      return JPEG_V2_UNSUPPORTED_PROFILE;
    for (index = 0; index < DCTSIZE2; index++)
      if (decoder->quant_tbl_ptrs[table]->quantval[index] == 0 ||
          decoder->quant_tbl_ptrs[table]->quantval[index] > 255)
        return JPEG_V2_UNSUPPORTED_PROFILE;
  }
  return JPEG_V2_OK;
}

static void close_source(gate_source *source) {
  jpeg_destroy_decompress(&source->decoder);
  memset(source, 0, sizeof(*source));
}

static int open_source(gate_source *source, const uint8_t *input,
                       uint32_t length) {
  int status;
  uint8_t frame_marker;
  memset(source, 0, sizeof(*source));
  init_error(&source->error);
  status = scan_complete_jpeg(input, length, &source->scan_count, &frame_marker,
                              &source->orientation);
  if (status != JPEG_V2_OK) return status;
  source->decoder.err = &source->error.pub;
  if (setjmp(source->error.jump)) {
    status = source->error.status;
    jpeg_destroy_decompress(&source->decoder);
    memset(source, 0, sizeof(*source));
    return status;
  }
  jpeg_create_decompress(&source->decoder);
  source->decoder.mem->max_memory_to_use = 192u * 1024u * 1024u;
  jpeg_mem_src(&source->decoder, input, length);
  if (jpeg_read_header(&source->decoder, TRUE) != JPEG_HEADER_OK) {
    close_source(source);
    return JPEG_V2_MALFORMED;
  }
  status = validate_profile(&source->decoder);
  if (status != JPEG_V2_OK) {
    close_source(source);
    return status;
  }
  source->coefficients = jpeg_read_coefficients(&source->decoder);
  if (source->coefficients == NULL) {
    close_source(source);
    return JPEG_V2_MALFORMED;
  }
  return JPEG_V2_OK;
}

static int coefficient_value(gate_source *source, int component,
                             uint32_t block_index, uint8_t zigzag_position,
                             int16_t *value, int writable, int16_t replacement,
                             int replace) {
  jpeg_component_info *info = &source->decoder.comp_info[component];
  uint32_t row;
  uint32_t column;
  JBLOCKARRAY blocks;
  if (info->width_in_blocks == 0) return JPEG_V2_MALFORMED;
  row = block_index / info->width_in_blocks;
  column = block_index % info->width_in_blocks;
  if (row >= info->height_in_blocks || zigzag_position >= 64)
    return JPEG_V2_MALFORMED;
  blocks = (*source->decoder.mem->access_virt_barray)(
      (j_common_ptr)&source->decoder, source->coefficients[component], row, 1,
      writable ? TRUE : FALSE);
  if (blocks == NULL) return JPEG_V2_ALLOCATION_FAILED;
  if (replace)
    blocks[0][column][zigzag_to_natural[zigzag_position]] = replacement;
  *value = blocks[0][column][zigzag_to_natural[zigzag_position]];
  return JPEG_V2_OK;
}

static int physical_value(gate_source *source, uint32_t physical,
                          int16_t *value, int writable, int16_t replacement,
                          int replace) {
  uint32_t block = physical / 63u;
  uint8_t zigzag = (uint8_t)(physical % 63u + 1u);
  return coefficient_value(source, 0, block, zigzag, value, writable,
                           replacement, replace);
}

static uint32_t magnitude_i16(int16_t value) {
  int32_t widened = value;
  return (uint32_t)(widened < 0 ? -widened : widened);
}

static int eligible_value(int16_t value) {
  uint32_t magnitude = magnitude_i16(value);
  return magnitude >= 2u && magnitude <= 1023u;
}

static int analyse_coefficients(gate_source *source, gate_info *info) {
  uint32_t domain;
  uint32_t eligible = 0;
  int component;
  memset(info, 0, sizeof(*info));
  if (!checked_mul_u32(source->decoder.comp_info[0].width_in_blocks,
                       source->decoder.comp_info[0].height_in_blocks,
                       &domain) ||
      !checked_mul_u32(domain, 63u, &domain))
    return JPEG_V2_UNSUPPORTED_PROFILE;
  for (component = 0; component < source->decoder.num_components; component++) {
    jpeg_component_info *component_info = &source->decoder.comp_info[component];
    uint32_t block_count;
    uint32_t block;
    int32_t previous_dc = 0;
    if (!checked_mul_u32(component_info->width_in_blocks,
                         component_info->height_in_blocks, &block_count))
      return JPEG_V2_UNSUPPORTED_PROFILE;
    for (block = 0; block < block_count; block++) {
      uint8_t zigzag;
      int16_t dc;
      int status = coefficient_value(source, component, block, 0, &dc, 0, 0, 0);
      int32_t difference;
      if (status != JPEG_V2_OK) return status;
      difference = (int32_t)dc - previous_dc;
      if (difference < -2047 || difference > 2047)
        return JPEG_V2_UNSUPPORTED_PROFILE;
      previous_dc = dc;
      for (zigzag = 1; zigzag < 64; zigzag++) {
        int16_t value;
        status = coefficient_value(source, component, block, zigzag, &value, 0,
                                   0, 0);
        if (status != JPEG_V2_OK) return status;
        if (magnitude_i16(value) > 1023u)
          return JPEG_V2_UNSUPPORTED_PROFILE;
        if (component == 0 && eligible_value(value)) eligible++;
      }
    }
  }
  info->width = source->decoder.image_width;
  info->height = source->decoder.image_height;
  info->components = source->decoder.num_components;
  info->progressive = source->decoder.progressive_mode ? 1u : 0u;
  info->sampling = source->decoder.num_components == 1
                       ? 400u
                       : (source->decoder.comp_info[0].v_samp_factor == 2
                              ? 420u
                              : (source->decoder.comp_info[0].h_samp_factor == 2
                                     ? 422u
                                     : 444u));
  info->luminance_blocks_wide = source->decoder.comp_info[0].width_in_blocks;
  info->luminance_blocks_high = source->decoder.comp_info[0].height_in_blocks;
  info->physical_domain_size = domain;
  info->eligible_coefficients = eligible;
  if (eligible > JPEG_V2_HEADER_COEFFICIENTS) {
    uint32_t groups = (eligible - JPEG_V2_HEADER_COEFFICIENTS) / 7u;
  info->payload_byte_capacity = (groups * 3u) / 8u;
    if (info->payload_byte_capacity > JPEG_V2_MAX_PAYLOAD)
      info->payload_byte_capacity = JPEG_V2_MAX_PAYLOAD;
  }
  info->orientation = source->orientation;
  return JPEG_V2_OK;
}

static void digest_u8(jpeg_v2_sha256 *digest, uint8_t value) {
  sha256_update(digest, &value, 1u);
}

static void digest_u16(jpeg_v2_sha256 *digest, uint16_t value) {
  uint8_t bytes[2] = {(uint8_t)(value >> 8), (uint8_t)value};
  sha256_update(digest, bytes, sizeof(bytes));
}

static void digest_u32(jpeg_v2_sha256 *digest, uint32_t value) {
  uint8_t bytes[4] = {(uint8_t)(value >> 24), (uint8_t)(value >> 16),
                      (uint8_t)(value >> 8), (uint8_t)value};
  sha256_update(digest, bytes, sizeof(bytes));
}

/*
 * Canonical verification digest, representation version 1:
 * ASCII "LTV2VERIFY", representation version, canonical output properties,
 * image/component fields, referenced quantization tables, then every real
 * coefficient in component/block/zigzag order.  Integers are big-endian and
 * signed coefficients are represented by their two's-complement uint16 bits.
 */
static int canonical_state_digest(gate_source *source, uint8_t output[32]) {
  static const uint8_t prefix[] = {'L', 'T', 'V', '2', 'V',
                                    'E', 'R', 'I', 'F', 'Y'};
  jpeg_v2_sha256 digest;
  uint8_t referenced_tables[NUM_QUANT_TBLS] = {0};
  int component;
  int table;
  sha256_init(&digest);
  sha256_update(&digest, prefix, sizeof(prefix));
  digest_u8(&digest, 1u);
  /* SOF0, 8-bit, Huffman, one scan, no restart/optimization, JFIF 1.01. */
  digest_u8(&digest, MARKER_SOF0);
  digest_u8(&digest, 8u);
  digest_u8(&digest, 0u);
  digest_u8(&digest, 1u);
  digest_u32(&digest, 0u);
  digest_u8(&digest, 0u);
  digest_u8(&digest, 1u);
  digest_u8(&digest, 1u);
  digest_u8(&digest, source->orientation >= 2u ? source->orientation : 0u);
  digest_u32(&digest, source->decoder.image_width);
  digest_u32(&digest, source->decoder.image_height);
  digest_u8(&digest, (uint8_t)source->decoder.num_components);
  for (component = 0; component < source->decoder.num_components; component++) {
    jpeg_component_info *info = &source->decoder.comp_info[component];
    if (info->quant_tbl_no < 0 || info->quant_tbl_no >= NUM_QUANT_TBLS)
      return JPEG_V2_SELF_VERIFY_FAILED;
    referenced_tables[info->quant_tbl_no] = 1u;
    digest_u8(&digest, (uint8_t)info->component_id);
    digest_u8(&digest, (uint8_t)info->h_samp_factor);
    digest_u8(&digest, (uint8_t)info->v_samp_factor);
    digest_u8(&digest, (uint8_t)info->quant_tbl_no);
    digest_u32(&digest, info->width_in_blocks);
    digest_u32(&digest, info->height_in_blocks);
  }
  for (table = 0; table < NUM_QUANT_TBLS; table++) {
    int index;
    if (!referenced_tables[table]) continue;
    if (source->decoder.quant_tbl_ptrs[table] == NULL)
      return JPEG_V2_SELF_VERIFY_FAILED;
    digest_u8(&digest, (uint8_t)table);
    for (index = 0; index < DCTSIZE2; index++)
      digest_u16(&digest, source->decoder.quant_tbl_ptrs[table]->quantval[index]);
  }
  for (component = 0; component < source->decoder.num_components; component++) {
    jpeg_component_info *info = &source->decoder.comp_info[component];
    uint32_t block_count;
    uint32_t block;
    if (!checked_mul_u32(info->width_in_blocks, info->height_in_blocks,
                         &block_count))
      return JPEG_V2_SELF_VERIFY_FAILED;
    for (block = 0; block < block_count; block++) {
      uint8_t zigzag;
      for (zigzag = 0; zigzag < 64u; zigzag++) {
        int16_t value;
        int status = coefficient_value(source, component, block, zigzag,
                                       &value, 0, 0, 0);
        if (status != JPEG_V2_OK) return status;
        digest_u16(&digest, (uint16_t)value);
      }
    }
  }
  sha256_final(&digest, output);
  return JPEG_V2_OK;
}

static int collect_header_indices(gate_source *source, uint32_t *indices,
                                  uint32_t wanted, uint32_t *found) {
  uint32_t physical;
  uint32_t count = 0;
  uint32_t block_count;
  if (!checked_mul_u32(source->decoder.comp_info[0].width_in_blocks,
                       source->decoder.comp_info[0].height_in_blocks,
                       &block_count) ||
      !checked_mul_u32(block_count, 63u, &block_count))
    return JPEG_V2_UNSUPPORTED_PROFILE;
  for (physical = 0; physical < block_count && count < wanted; physical++) {
    int16_t value;
    int status = physical_value(source, physical, &value, 0, 0, 0);
    if (status != JPEG_V2_OK) return status;
    if (eligible_value(value)) indices[count++] = physical;
  }
  *found = count;
  return JPEG_V2_OK;
}

static uint8_t bit_at(const uint8_t *bytes, uint32_t bit) {
  return (uint8_t)((bytes[bit / 8u] >> (7u - (bit % 8u))) & 1u);
}

static void set_bit(uint8_t *bytes, uint32_t bit, uint8_t value) {
  uint8_t mask = (uint8_t)(1u << (7u - (bit % 8u)));
  if (value)
    bytes[bit / 8u] |= mask;
  else
    bytes[bit / 8u] &= (uint8_t)~mask;
}

static int process_group(gate_source *source, const uint32_t group[7],
                         const uint8_t *input, uint32_t input_bits,
                         uint32_t input_offset, uint8_t *output, int embed) {
  uint8_t syndrome = 0;
  uint8_t desired = 0;
  uint8_t index;
  for (index = 0; index < 7; index++) {
    int16_t value;
    int status = physical_value(source, group[index], &value, 0, 0, 0);
    if (status != JPEG_V2_OK || !eligible_value(value))
      return status == JPEG_V2_OK ? JPEG_V2_DAMAGED : status;
    if ((magnitude_i16(value) & 1u) != 0) syndrome ^= (uint8_t)(index + 1u);
  }
  if (!embed) {
    for (index = 0; index < 3 && input_offset + index < input_bits; index++)
      set_bit(output, input_offset + index,
              (uint8_t)((syndrome >> (2u - index)) & 1u));
    return JPEG_V2_OK;
  }
  for (index = 0; index < 3; index++) {
    desired <<= 1;
    if (input_offset + index < input_bits)
      desired |= bit_at(input, input_offset + index);
  }
  index = (uint8_t)(syndrome ^ desired);
  if (index != 0) {
    int16_t original;
    int16_t replacement;
    uint32_t magnitude;
    int status = physical_value(source, group[index - 1u], &original, 0, 0, 0);
    if (status != JPEG_V2_OK || !eligible_value(original))
      return status == JPEG_V2_OK ? JPEG_V2_DAMAGED : status;
    magnitude = magnitude_i16(original);
    magnitude = (magnitude & 1u) == 0 ? magnitude + 1u : magnitude - 1u;
    replacement = (int16_t)(original < 0 ? -(int32_t)magnitude
                                         : (int32_t)magnitude);
    status = physical_value(source, group[index - 1u], &original, 1,
                            replacement, 1);
    if (status != JPEG_V2_OK || original != replacement ||
        !eligible_value(original))
      return JPEG_V2_SELF_VERIFY_FAILED;
  }
  return JPEG_V2_OK;
}

static int reserved_index(const uint32_t *reserved, uint32_t physical) {
  uint32_t low = 0;
  uint32_t high = JPEG_V2_HEADER_COEFFICIENTS;
  while (low < high) {
    uint32_t middle = low + (high - low) / 2u;
    if (reserved[middle] == physical) return 1;
    if (reserved[middle] < physical)
      low = middle + 1u;
    else
      high = middle;
  }
  return 0;
}

static uint32_t gcd_u32(uint32_t left, uint32_t right) {
  while (right != 0) {
    uint32_t next = left % right;
    left = right;
    right = next;
  }
  return left;
}

static uint32_t read_u32_be(const uint8_t *bytes) {
  return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
         ((uint32_t)bytes[2] << 8) | bytes[3];
}

static int bytes_all_zero(const uint8_t *bytes, uint32_t length) {
  uint8_t combined = 0;
  uint32_t index;
  for (index = 0; index < length; index++) combined |= bytes[index];
  return combined == 0;
}

static int validate_v2_header(const uint8_t *header, const gate_info *info) {
  uint32_t payload_length;
  uint32_t iterations;
  uint32_t start;
  uint32_t step;
  if (memcmp(header, "LTSG", 4) != 0) return JPEG_V2_NO_MESSAGE;
  if (header[4] != 2u) return JPEG_V2_UNSUPPORTED_VERSION;
  if (header[5] != 0u) return JPEG_V2_DAMAGED;
  if (header[6] != 2u) return JPEG_V2_UNSUPPORTED_FORMAT;
  if (header[7] != 0u && header[7] != 1u)
    return JPEG_V2_UNSUPPORTED_FORMAT;
  payload_length = read_u32_be(header + 8);
  iterations = read_u32_be(header + 12);
  start = read_u32_be(header + 76);
  step = read_u32_be(header + 80);
  if (info->physical_domain_size == 0 || start >= info->physical_domain_size ||
      step == 0 || step >= info->physical_domain_size ||
      gcd_u32(step, info->physical_domain_size) != 1 ||
      payload_length == 0 || payload_length > info->payload_byte_capacity)
    return JPEG_V2_DAMAGED;
  if (header[7] == 0u) {
    if (payload_length > 1024u * 1024u || iterations != 0u ||
        !bytes_all_zero(header + 16, 16u) ||
        !bytes_all_zero(header + 32, 12u))
      return JPEG_V2_DAMAGED;
  } else if (payload_length <= 16u ||
             payload_length > 1024u * 1024u + 16u ||
             iterations != 600000u ||
             !bytes_all_zero(header + 44, 32u)) {
    return JPEG_V2_DAMAGED;
  }
  return JPEG_V2_OK;
}

static int process_header(gate_source *source, uint32_t reserved[1568],
                          const uint8_t *input, uint8_t *output, int embed) {
  uint32_t found;
  uint32_t group;
  int status = collect_header_indices(source, reserved,
                                      JPEG_V2_HEADER_COEFFICIENTS, &found);
  if (status != JPEG_V2_OK) return status;
  if (found < JPEG_V2_HEADER_COEFFICIENTS) return JPEG_V2_CAPACITY;
  for (group = 0; group < JPEG_V2_HEADER_GROUPS; group++) {
    status = process_group(source, reserved + group * 7u, input,
                           JPEG_V2_HEADER_BITS, group * 3u, output, embed);
    if (status != JPEG_V2_OK) return status;
  }
  return JPEG_V2_OK;
}

static int process_payload(gate_source *source, const uint32_t *reserved,
                           uint32_t start, uint32_t step,
                           const uint8_t *input, uint32_t byte_length,
                           uint8_t *output, int embed) {
  uint32_t domain;
  uint32_t physical;
  uint32_t visits;
  uint32_t group[7];
  uint32_t group_count = 0;
  uint32_t bit_offset = 0;
  uint32_t bit_length;
  if (byte_length > UINT32_MAX / 8u) return JPEG_V2_INVALID_ARGUMENT;
  bit_length = byte_length * 8u;
  if (!checked_mul_u32(source->decoder.comp_info[0].width_in_blocks,
                       source->decoder.comp_info[0].height_in_blocks,
                       &domain) ||
      !checked_mul_u32(domain, 63u, &domain) || domain == 0 || start >= domain ||
      step == 0 || step >= domain || gcd_u32(step, domain) != 1)
    return JPEG_V2_DAMAGED;
  physical = start;
  for (visits = 0; visits < domain && bit_offset < bit_length; visits++) {
    int16_t value;
    int status = physical_value(source, physical, &value, 0, 0, 0);
    if (status != JPEG_V2_OK) return status;
    if (eligible_value(value) && !reserved_index(reserved, physical)) {
      group[group_count++] = physical;
      if (group_count == 7) {
        status = process_group(source, group, input, bit_length, bit_offset,
                               output, embed);
        if (status != JPEG_V2_OK) return status;
        bit_offset += bit_length - bit_offset >= 3u ? 3u : bit_length - bit_offset;
        group_count = 0;
      }
    }
    physical += step;
    if (physical >= domain) physical -= domain;
  }
  return bit_offset == bit_length ? JPEG_V2_OK : JPEG_V2_CAPACITY;
}

static void destination_init(j_compress_ptr compressor) {
  bounded_destination *destination = (bounded_destination *)compressor->dest;
  size_t initial = 64u * 1024u;
  if (initial > destination->limit) initial = destination->limit;
  destination->buffer = (JOCTET *)malloc(initial);
  if (destination->buffer == NULL) {
    destination->error->status = JPEG_V2_ALLOCATION_FAILED;
    ERREXIT(compressor, JERR_OUT_OF_MEMORY);
  }
  destination->capacity = initial;
  destination->length = 0;
  destination->pub.next_output_byte = destination->buffer;
  destination->pub.free_in_buffer = initial;
}

static boolean destination_grow(j_compress_ptr compressor) {
  bounded_destination *destination = (bounded_destination *)compressor->dest;
  size_t used = destination->capacity;
  size_t next = destination->capacity <= destination->limit / 2u
                    ? destination->capacity * 2u
                    : destination->limit;
  JOCTET *replacement;
  if (used >= destination->limit || next <= used) {
    destination->error->status = JPEG_V2_OUTPUT_TOO_LARGE;
    ERREXIT(compressor, JERR_FILE_WRITE);
  }
  replacement = (JOCTET *)realloc(destination->buffer, next);
  if (replacement == NULL) {
    destination->error->status = JPEG_V2_ALLOCATION_FAILED;
    ERREXIT(compressor, JERR_OUT_OF_MEMORY);
  }
  destination->buffer = replacement;
  destination->capacity = next;
  destination->pub.next_output_byte = replacement + used;
  destination->pub.free_in_buffer = next - used;
  return TRUE;
}

static void destination_finish(j_compress_ptr compressor) {
  bounded_destination *destination = (bounded_destination *)compressor->dest;
  destination->length = destination->capacity - destination->pub.free_in_buffer;
}

static int serialize_source(gate_source *source, uint8_t **output,
                            uint32_t *output_length) {
  serialization_context *context =
      (serialization_context *)calloc(1, sizeof(serialization_context));
  int status;
  if (context == NULL) return JPEG_V2_ALLOCATION_FAILED;
  init_error(&context->error);
  context->compressor.err = &context->error.pub;
  context->destination.error = &context->error;
  context->destination.limit = JPEG_V2_MAX_OUTPUT;
  if (setjmp(context->error.jump)) {
    status = context->error.status;
    if (context->compressor_created)
      jpeg_destroy_compress(&context->compressor);
    if (context->destination.buffer != NULL) {
      memset(context->destination.buffer, 0, context->destination.capacity);
      free(context->destination.buffer);
    }
    memset(context, 0, sizeof(*context));
    free(context);
    return status;
  }
  jpeg_create_compress(&context->compressor);
  context->compressor_created = 1;
  jpeg_copy_critical_parameters(&source->decoder, &context->compressor);
  context->compressor.arith_code = FALSE;
  context->compressor.optimize_coding = FALSE;
  context->compressor.progressive_mode = FALSE;
  context->compressor.scan_info = NULL;
  context->compressor.num_scans = 0;
  context->compressor.restart_interval = 0;
  context->compressor.restart_in_rows = 0;
  context->compressor.write_JFIF_header = TRUE;
  context->compressor.JFIF_major_version = 1;
  context->compressor.JFIF_minor_version = 1;
  context->compressor.density_unit = 0;
  context->compressor.X_density = 1;
  context->compressor.Y_density = 1;
  context->compressor.write_Adobe_marker = FALSE;
  context->destination.pub.init_destination = destination_init;
  context->destination.pub.empty_output_buffer = destination_grow;
  context->destination.pub.term_destination = destination_finish;
  context->compressor.dest =
      (struct jpeg_destination_mgr *)&context->destination;
  jpeg_write_coefficients(&context->compressor, source->coefficients);
  if (source->orientation >= 2u && source->orientation <= 8u) {
    uint8_t exif[32];
    canonical_exif(exif, source->orientation);
    jpeg_write_marker(&context->compressor, JPEG_APP0 + 1, exif,
                      sizeof(exif));
  }
  jpeg_finish_compress(&context->compressor);
  jpeg_destroy_compress(&context->compressor);
  context->compressor_created = 0;
  if (context->destination.length == 0 ||
      context->destination.length > UINT32_MAX) {
    memset(context->destination.buffer, 0, context->destination.capacity);
    free(context->destination.buffer);
    memset(context, 0, sizeof(*context));
    free(context);
    return JPEG_V2_OUTPUT_TOO_LARGE;
  }
  *output = context->destination.buffer;
  *output_length = (uint32_t)context->destination.length;
  context->destination.buffer = NULL;
  memset(context, 0, sizeof(*context));
  free(context);
  return JPEG_V2_OK;
}

static int inspect_internal(const uint8_t *input, uint32_t input_length,
                            uint8_t **header, uint8_t **payload,
                            uint32_t *payload_length, gate_info *info) {
  gate_source source;
  uint32_t reserved[JPEG_V2_HEADER_COEFFICIENTS];
  uint32_t first[JPEG_V2_HEADER_COEFFICIENTS];
  uint32_t found;
  uint8_t magic[4] = {0, 0, 0, 0};
  uint8_t *decoded_header = NULL;
  uint8_t *decoded_payload = NULL;
  uint32_t declared_payload;
  uint32_t start;
  uint32_t step;
  int status = open_source(&source, input, input_length);
  if (status != JPEG_V2_OK) return status;
  status = analyse_coefficients(&source, info);
  if (status != JPEG_V2_OK) {
    close_source(&source);
    return status;
  }
  status = collect_header_indices(&source, first, 77u, &found);
  if (status != JPEG_V2_OK) {
    close_source(&source);
    return status;
  }
  if (found < 77u) {
    close_source(&source);
    return JPEG_V2_NO_MESSAGE;
  }
  {
    uint32_t group;
    for (group = 0; group < 11u; group++) {
      status = process_group(&source, first + group * 7u, NULL, 32u,
                             group * 3u, magic, 0);
      if (status != JPEG_V2_OK) {
        close_source(&source);
        return status;
      }
    }
  }
  if (memcmp(magic, "LTSG", 4) != 0) {
    close_source(&source);
    return JPEG_V2_NO_MESSAGE;
  }
  decoded_header = (uint8_t *)calloc(1, JPEG_V2_HEADER_BYTES);
  if (decoded_header == NULL) {
    close_source(&source);
    return JPEG_V2_ALLOCATION_FAILED;
  }
  status = process_header(&source, reserved, NULL, decoded_header, 0);
  if (status == JPEG_V2_CAPACITY) status = JPEG_V2_DAMAGED;
  if (status != JPEG_V2_OK) goto failed;
  if (memcmp(decoded_header, "LTSG", 4) != 0) {
    status = JPEG_V2_DAMAGED;
    goto failed;
  }
  status = validate_v2_header(decoded_header, info);
  if (status != JPEG_V2_OK) goto failed;
  declared_payload = read_u32_be(decoded_header + 8);
  start = read_u32_be(decoded_header + 76);
  step = read_u32_be(decoded_header + 80);
  decoded_payload = (uint8_t *)calloc(1, declared_payload);
  if (decoded_payload == NULL) {
    status = JPEG_V2_ALLOCATION_FAILED;
    goto failed;
  }
  status = process_payload(&source, reserved, start, step, NULL,
                           declared_payload, decoded_payload, 0);
  if (status == JPEG_V2_CAPACITY) status = JPEG_V2_DAMAGED;
  if (status != JPEG_V2_OK) goto failed;
  close_source(&source);
  *header = decoded_header;
  *payload = decoded_payload;
  *payload_length = declared_payload;
  return JPEG_V2_OK;

failed:
  close_source(&source);
  if (decoded_header != NULL) {
    memset(decoded_header, 0, JPEG_V2_HEADER_BYTES);
    free(decoded_header);
  }
  if (decoded_payload != NULL) {
    memset(decoded_payload, 0, declared_payload);
    free(decoded_payload);
  }
  return status;
}

EMSCRIPTEN_KEEPALIVE int jpegv2_analyze(const uint8_t *input,
                                        uint32_t input_length) {
  gate_source source;
  int status;
  reset_results();
  if (input == NULL || input_length == 0 ||
      input_length > JPEG_V2_MAX_HIDE_INPUT)
    return JPEG_V2_INVALID_ARGUMENT;
  status = open_source(&source, input, input_length);
  if (status != JPEG_V2_OK) return status;
  status = analyse_coefficients(&source, &last_info);
  close_source(&source);
  return status;
}

EMSCRIPTEN_KEEPALIVE int jpegv2_encode(const uint8_t *input,
                                       uint32_t input_length,
                                       const uint8_t *header,
                                       uint32_t header_length,
                                       const uint8_t *payload,
                                       uint32_t payload_length) {
  gate_source source;
  gate_source verification_source;
  gate_info info;
  gate_info verification_info;
  uint32_t reserved[JPEG_V2_HEADER_COEFFICIENTS];
  uint8_t *output = NULL;
  uint32_t output_length = 0;
  uint8_t *verified_header = NULL;
  uint8_t *verified_payload = NULL;
  uint32_t verified_payload_length = 0;
  uint32_t start;
  uint32_t step;
  uint8_t expected_digest[32] = {0};
  uint8_t actual_digest[32] = {0};
  uint8_t expected_orientation;
  int status;
  reset_results();
  if (input == NULL || header == NULL || payload == NULL || input_length == 0 ||
      input_length > JPEG_V2_MAX_HIDE_INPUT ||
      header_length != JPEG_V2_HEADER_BYTES || payload_length == 0 ||
      payload_length > JPEG_V2_MAX_PAYLOAD || memcmp(header, "LTSG", 4) != 0 ||
      header[4] != 2 || header[5] != 0 || header[6] != 2 ||
      read_u32_be(header + 8) != payload_length)
    return JPEG_V2_INVALID_ARGUMENT;
  status = open_source(&source, input, input_length);
  if (status != JPEG_V2_OK) return status;
  status = analyse_coefficients(&source, &info);
  if (status != JPEG_V2_OK || payload_length > info.payload_byte_capacity) {
    close_source(&source);
    return status == JPEG_V2_OK ? JPEG_V2_CAPACITY : status;
  }
  status = validate_v2_header(header, &info);
  if (status != JPEG_V2_OK) {
    close_source(&source);
    return JPEG_V2_INVALID_ARGUMENT;
  }
  start = read_u32_be(header + 76);
  step = read_u32_be(header + 80);
  expected_orientation = source.orientation;
  status = process_header(&source, reserved, header, NULL, 1);
  if (status == JPEG_V2_OK)
    status = process_payload(&source, reserved, start, step, payload,
                             payload_length, NULL, 1);
  if (status == JPEG_V2_OK)
    status = canonical_state_digest(&source, expected_digest);
  if (status == JPEG_V2_OK)
    status = serialize_source(&source, &output, &output_length);
  close_source(&source);
  if (status != JPEG_V2_OK) return status;
  status = validate_canonical_markers(output, output_length,
                                      expected_orientation);
  if (status == JPEG_V2_OK)
    status = open_source(&verification_source, output, output_length);
  if (status == JPEG_V2_OK) {
    status = analyse_coefficients(&verification_source, &verification_info);
    if (status == JPEG_V2_OK)
      status = canonical_state_digest(&verification_source, actual_digest);
    close_source(&verification_source);
  }
  if (status != JPEG_V2_OK ||
      memcmp(expected_digest, actual_digest, sizeof(expected_digest)) != 0) {
    memset(expected_digest, 0, sizeof(expected_digest));
    memset(actual_digest, 0, sizeof(actual_digest));
    memset(output, 0, output_length);
    free(output);
    return JPEG_V2_SELF_VERIFY_FAILED;
  }
  status = inspect_internal(output, output_length, &verified_header,
                            &verified_payload, &verified_payload_length,
                            &last_info);
  if (status != JPEG_V2_OK || verified_payload_length != payload_length ||
      memcmp(verified_header, header, JPEG_V2_HEADER_BYTES) != 0 ||
      memcmp(verified_payload, payload, payload_length) != 0) {
    if (verified_header != NULL) free(verified_header);
    if (verified_payload != NULL) free(verified_payload);
    memset(output, 0, output_length);
    free(output);
    return JPEG_V2_SELF_VERIFY_FAILED;
  }
  free(verified_header);
  memset(verified_payload, 0, verified_payload_length);
  free(verified_payload);
  memset(expected_digest, 0, sizeof(expected_digest));
  memset(actual_digest, 0, sizeof(actual_digest));
  last_output = output;
  last_output_length = output_length;
  return JPEG_V2_OK;
}

EMSCRIPTEN_KEEPALIVE int jpegv2_inspect(const uint8_t *input,
                                        uint32_t input_length) {
  reset_results();
  if (input == NULL || input_length == 0 ||
      input_length > JPEG_V2_MAX_REVEAL_INPUT)
    return JPEG_V2_INVALID_ARGUMENT;
  return inspect_internal(input, input_length, &last_header, &last_payload,
                          &last_payload_length, &last_info);
}

EMSCRIPTEN_KEEPALIVE void jpegv2_reset(void) { reset_results(); }

EMSCRIPTEN_KEEPALIVE jpegv2_pointer jpegv2_output_ptr(void) {
  return (jpegv2_pointer)(uintptr_t)last_output;
}
EMSCRIPTEN_KEEPALIVE uint32_t jpegv2_output_length(void) {
  return last_output_length;
}
EMSCRIPTEN_KEEPALIVE jpegv2_pointer jpegv2_header_ptr(void) {
  return (jpegv2_pointer)(uintptr_t)last_header;
}
EMSCRIPTEN_KEEPALIVE jpegv2_pointer jpegv2_payload_ptr(void) {
  return (jpegv2_pointer)(uintptr_t)last_payload;
}
EMSCRIPTEN_KEEPALIVE uint32_t jpegv2_payload_length(void) {
  return last_payload_length;
}
EMSCRIPTEN_KEEPALIVE uint32_t jpegv2_info_value(uint32_t field) {
  switch (field) {
    case 0: return last_info.width;
    case 1: return last_info.height;
    case 2: return last_info.components;
    case 3: return last_info.progressive;
    case 4: return last_info.sampling;
    case 5: return last_info.luminance_blocks_wide;
    case 6: return last_info.luminance_blocks_high;
    case 7: return last_info.physical_domain_size;
    case 8: return last_info.eligible_coefficients;
    case 9: return last_info.payload_byte_capacity;
    case 10: return last_info.orientation;
    default: return 0;
  }
}
