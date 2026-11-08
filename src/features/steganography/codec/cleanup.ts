export function zeroBuffer(buffer: ArrayBufferView | null | undefined) {
  if (!buffer || buffer.byteLength === 0) return;
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0);
}
export function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
