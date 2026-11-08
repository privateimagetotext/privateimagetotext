#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

int jpegv2_analyze(const uint8_t *input, uint32_t input_length);
int jpegv2_encode(const uint8_t *input, uint32_t input_length,
                  const uint8_t *header, uint32_t header_length,
                  const uint8_t *payload, uint32_t payload_length);
int jpegv2_inspect(const uint8_t *input, uint32_t input_length);
void jpegv2_reset(void);
uintptr_t jpegv2_output_ptr(void);
uint32_t jpegv2_output_length(void);
uintptr_t jpegv2_header_ptr(void);
uintptr_t jpegv2_payload_ptr(void);
uint32_t jpegv2_payload_length(void);
uint32_t jpegv2_info_value(uint32_t field);

enum {
  JPEG_V2_OK = 0,
  JPEG_V2_MALFORMED = 1,
  JPEG_V2_NO_MESSAGE = 6,
  JPEG_V2_INVALID_ARGUMENT = 11
};

static int read_file(const char *path, uint8_t **bytes, uint32_t *length) {
  FILE *file = fopen(path, "rb");
  long size;

  if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
      (size = ftell(file)) <= 0 || size > (long)UINT32_MAX ||
      fseek(file, 0, SEEK_SET) != 0) {
    if (file != NULL) fclose(file);
    return 0;
  }

  *bytes = (uint8_t *)malloc((size_t)size);
  if (*bytes == NULL || fread(*bytes, 1, (size_t)size, file) != (size_t)size) {
    free(*bytes);
    *bytes = NULL;
    fclose(file);
    return 0;
  }

  fclose(file);
  *length = (uint32_t)size;
  return 1;
}

static uint32_t gcd_u32(uint32_t left, uint32_t right) {
  while (right != 0u) {
    uint32_t next = left % right;
    left = right;
    right = next;
  }
  return left;
}

static void write_u32_be(uint8_t *bytes, uint32_t value) {
  bytes[0] = (uint8_t)(value >> 24);
  bytes[1] = (uint8_t)(value >> 16);
  bytes[2] = (uint8_t)(value >> 8);
  bytes[3] = (uint8_t)value;
}

static uint32_t next_random(uint32_t *state) {
  *state = *state * 1664525u + 1013904223u;
  return *state;
}

static int status_is_bounded(int status) {
  return status >= JPEG_V2_OK && status <= JPEG_V2_INVALID_ARGUMENT;
}

static int round_trip(const uint8_t *source, uint32_t source_length) {
  static const uint8_t payload[] = {
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff};
  uint8_t header[84] = {0};
  uint8_t *output_copy = NULL;
  uint32_t output_length;
  uint32_t domain;
  uint32_t step = 2u;
  int status;

  status = jpegv2_analyze(source, source_length);
  if (status != JPEG_V2_OK) {
    fprintf(stderr, "accepted fixture analyze returned %d\n", status);
    return 20;
  }

  domain = jpegv2_info_value(7);
  if (domain == 0u || jpegv2_info_value(9) < sizeof(payload)) return 21;
  while (step < domain && gcd_u32(step, domain) != 1u) step++;
  if (step >= domain) return 22;

  memcpy(header, "LTSG", 4);
  header[4] = 2;
  header[6] = 2;
  write_u32_be(header + 8, (uint32_t)sizeof(payload));
  write_u32_be(header + 76, 1u);
  write_u32_be(header + 80, step);

  status = jpegv2_encode(source, source_length, header, sizeof(header), payload,
                         sizeof(payload));
  if (status != JPEG_V2_OK) {
    fprintf(stderr, "accepted fixture encode returned %d\n", status);
    return 23;
  }

  output_length = jpegv2_output_length();
  if (output_length == 0u || jpegv2_output_ptr() == 0u) return 24;
  output_copy = (uint8_t *)malloc(output_length);
  if (output_copy == NULL) return 25;
  memcpy(output_copy, (const void *)jpegv2_output_ptr(), output_length);
  jpegv2_reset();

  status = jpegv2_inspect(output_copy, output_length);
  if (status != JPEG_V2_OK || jpegv2_payload_length() != sizeof(payload) ||
      jpegv2_header_ptr() == 0u || jpegv2_payload_ptr() == 0u ||
      memcmp((const void *)jpegv2_header_ptr(), header, sizeof(header)) != 0 ||
      memcmp((const void *)jpegv2_payload_ptr(), payload, sizeof(payload)) != 0) {
    fprintf(stderr, "fresh output inspect returned %d\n", status);
    memset(output_copy, 0, output_length);
    free(output_copy);
    return 26;
  }

  jpegv2_reset();
  memset(output_copy, 0, output_length);
  free(output_copy);
  return 0;
}

static int deterministic_corpus(const char *path) {
  static const uint32_t truncation_lengths[] = {1u, 2u, 3u, 7u, 31u, 127u};
  uint8_t *source = NULL;
  uint8_t *candidate = NULL;
  uint32_t source_length = 0;
  uint32_t state = 0x4c545347u;
  size_t index;
  int status;

  if (!read_file(path, &source, &source_length)) return 30;
  status = round_trip(source, source_length);
  if (status != 0) goto cleanup;

  status = jpegv2_analyze(NULL, 0);
  if (status != JPEG_V2_INVALID_ARGUMENT) {
    status = 31;
    goto cleanup;
  }

  for (index = 0; index < sizeof(truncation_lengths) / sizeof(truncation_lengths[0]); index++) {
    uint32_t length = truncation_lengths[index];
    if (length >= source_length) continue;
    if (jpegv2_analyze(source, length) == JPEG_V2_OK) {
      status = 32;
      goto cleanup;
    }
    jpegv2_reset();
  }

  candidate = (uint8_t *)malloc((size_t)source_length + 1u);
  if (candidate == NULL) {
    status = 33;
    goto cleanup;
  }
  memcpy(candidate, source, source_length);
  candidate[source_length] = 0x00;
  if (jpegv2_analyze(candidate, source_length + 1u) != JPEG_V2_MALFORMED) {
    status = 34;
    goto cleanup;
  }
  jpegv2_reset();

  for (index = 0; index < 512u; index++) {
    uint32_t mutation_count = next_random(&state) % 8u + 1u;
    uint32_t mutation;
    uint32_t candidate_length = source_length;

    memcpy(candidate, source, source_length);
    if (index % 11u == 0u) candidate_length = next_random(&state) % source_length;
    for (mutation = 0; mutation < mutation_count && candidate_length > 0u; mutation++) {
      uint32_t position = next_random(&state) % candidate_length;
      candidate[position] ^= (uint8_t)(next_random(&state) | 1u);
    }
    if (!status_is_bounded(jpegv2_analyze(candidate, candidate_length))) {
      status = 35;
      goto cleanup;
    }
    jpegv2_reset();
  }

  puts("native sanitizer corpus passed: 1 round trip, 8 fixed malformed cases, 512 deterministic mutations");
  status = 0;

cleanup:
  jpegv2_reset();
  if (candidate != NULL) {
    memset(candidate, 0, (size_t)source_length + 1u);
    free(candidate);
  }
  if (source != NULL) {
    memset(source, 0, source_length);
    free(source);
  }
  return status;
}

static int fuzz_smoke(const char *path, uint32_t iterations) {
  uint8_t *source = NULL;
  uint8_t *candidate = NULL;
  uint32_t source_length = 0;
  uint32_t state = 20260802u;
  uint32_t iteration;
  clock_t started = clock();

  if (iterations == 0u || !read_file(path, &source, &source_length)) return 40;
  candidate = (uint8_t *)malloc((size_t)source_length + 8u);
  if (candidate == NULL) {
    free(source);
    return 41;
  }

  for (iteration = 0; iteration < iterations; iteration++) {
    uint32_t mutation_count = next_random(&state) % 8u + 1u;
    uint32_t candidate_length = source_length;
    uint32_t mutation;

    memcpy(candidate, source, source_length);
    if (iteration % 11u == 0u && source_length > 2u) {
      candidate_length = next_random(&state) % source_length;
    } else if (iteration % 17u == 0u) {
      candidate_length = source_length + 1u;
      candidate[source_length] = (uint8_t)next_random(&state);
    }

    for (mutation = 0; mutation < mutation_count && candidate_length > 0u; mutation++) {
      uint32_t position = next_random(&state) % candidate_length;
      candidate[position] ^= (uint8_t)(next_random(&state) | 1u);
    }
    if (!status_is_bounded(jpegv2_analyze(candidate, candidate_length))) {
      fprintf(stderr, "unbounded status at iteration %u\n", iteration);
      return 42;
    }
    jpegv2_reset();
  }

  memset(candidate, 0, (size_t)source_length + 8u);
  free(candidate);
  memset(source, 0, source_length);
  free(source);
  printf("bounded deterministic fuzz smoke passed: %u iterations in %.3f CPU seconds\n",
         iterations, (double)(clock() - started) / CLOCKS_PER_SEC);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--corpus") == 0)
    return deterministic_corpus(argv[2]);
  if (argc == 4 && strcmp(argv[1], "--fuzz") == 0)
    return fuzz_smoke(argv[2], (uint32_t)strtoul(argv[3], NULL, 10));
  fprintf(stderr, "usage: jpeg-v2-security-test --corpus JPEG | --fuzz JPEG ITERATIONS\n");
  return 2;
}
