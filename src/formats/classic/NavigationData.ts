export const ATTRIBUTE_MAP_SIDE = 1024;
export const ATTRIBUTE_MAP_BYTES = ATTRIBUTE_MAP_SIDE * ATTRIBUTE_MAP_SIDE;
export const OBJECT_MASK_COUNT = 2048;
export const OBJECT_MASK_SIDE = 16;
export const OBJECT_MASK_BYTES = OBJECT_MASK_COUNT * OBJECT_MASK_SIDE * OBJECT_MASK_SIDE;

/** The 170 non-NUL bytes consumed by strlen(ObjectMaskEncKeys). */
const OBJECT_MASK_ENCRYPTION_KEY = new Uint8Array([
  0xb1, 0xdd, 0xb0, 0xad, 0xbb, 0xea, 0xc3, 0xa3, 0xbe, 0xc6, 0xb0, 0xa1, 0xc0, 0xda, 0xc0, 0xcf, 0xb8,
  0xb8, 0xc0, 0xcc, 0xc3, 0xb5, 0xba, 0xc0, 0xba, 0xbc, 0xbc, 0xf6, 0xb7, 0xcf, 0xbe, 0xc6, 0xb8, 0xa7,
  0xb4, 0xe4, 0xb0, 0xed, 0xbd, 0xc5, 0xba, 0xf1, 0xc7, 0xcf, 0xb1, 0xb8, 0xb3, 0xaa, 0xbf, 0xec, 0xb8,
  0xae, 0xb3, 0xaa, 0xb6, 0xf3, 0xc1, 0xc1, 0xc0, 0xba, 0xb3, 0xaa, 0xb6, 0xf3, 0xbb, 0xf5, 0xb3, 0xaa,
  0xb6, 0xf3, 0xc0, 0xc7, 0xbe, 0xee, 0xb8, 0xb0, 0xc0, 0xcc, 0xb4, 0xc2, 0xc0, 0xcf, 0xc2, 0xef, 0xc0,
  0xcf, 0xbe, 0xee, 0xb3, 0xb3, 0xb4, 0xcf, 0xb4, 0xd9, 0xc0, 0xe1, 0xb2, 0xd9, 0xb7, 0xaf, 0xb1, 0xe2,
  0xbe, 0xf8, 0xb4, 0xc2, 0xb3, 0xaa, 0xb6, 0xf3, 0xbf, 0xec, 0xb8, 0xae, 0xb3, 0xaa, 0xb6, 0xf3, 0xc1,
  0xc1, 0xc0, 0xba, 0xb3, 0xaa, 0xb6, 0xf3, 0xb9, 0xab, 0xb1, 0xc3, 0xc8, 0xad, 0xb9, 0xab, 0xb1, 0xc3,
  0xc8, 0xad, 0xbf, 0xec, 0xb8, 0xae, 0xb3, 0xaa, 0xb6, 0xf3, 0xb2, 0xc9, 0xbb, 0xef, 0xc3, 0xb5, 0xb8,
  0xae, 0xb0, 0xad, 0xbb, 0xea, 0xbf, 0xa1, 0xbf, 0xec, 0xb8, 0xae, 0xb3, 0xaa, 0xb6, 0xf3, 0xb2, 0xc9,
]);

export interface ClassicAttributeMap {
  /** Raw unsigned flags, indexed as [y][x]. */
  readonly values: Uint8Array;
  readonly baseChecksum: number;
  readonly embeddedChecksum: number | null;
}

export interface ClassicObjectMasks {
  /** Decrypted signed chars, indexed as [mask][y][x]. */
  readonly values: Int8Array;
  readonly encryptedChecksum: number;
}

export interface ClassicNavigationData {
  readonly attributes: ClassicAttributeMap;
  readonly objectMasks: ClassicObjectMasks;
}

/** Parses the 1024x1024 g_pAttribute table and its optional trailing checksum. */
export function parseAttributeMap(buffer: ArrayBuffer, expectedChecksum?: number): ClassicAttributeMap {
  if (buffer.byteLength !== ATTRIBUTE_MAP_BYTES && buffer.byteLength !== ATTRIBUTE_MAP_BYTES + 4) {
    throw new Error(`AttributeMap.dat possui ${buffer.byteLength} bytes; esperado ${ATTRIBUTE_MAP_BYTES} ou ${ATTRIBUTE_MAP_BYTES + 4}`);
  }
  const values = new Uint8Array(buffer, 0, ATTRIBUTE_MAP_BYTES).slice();
  const baseChecksum = calculateBaseChecksum(values);
  const embeddedChecksum = buffer.byteLength === ATTRIBUTE_MAP_BYTES + 4
    ? new DataView(buffer).getInt32(ATTRIBUTE_MAP_BYTES, true)
    : null;
  if (embeddedChecksum !== null && embeddedChecksum !== baseChecksum) {
    throw new Error(`Checksum de AttributeMap.dat invalido: ${embeddedChecksum}; calculado ${baseChecksum}`);
  }
  if (expectedChecksum !== undefined && expectedChecksum !== baseChecksum) {
    throw new Error(`AttributeMap.dat nao corresponde ao manifesto: ${baseChecksum}; esperado ${expectedChecksum}`);
  }
  return { values, baseChecksum, embeddedChecksum };
}

/** Reproduces BASE_GetSum with MSVC signed-char and int32 arithmetic. */
export function calculateBaseChecksum(values: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    const value = signedByte(values[index] ?? 0);
    const mod = index % 7;
    if (mod === 0) sum = (sum + Math.trunc(value / 2)) | 0;
    if (mod === 1) sum = (sum + (value ^ 0xff)) | 0;
    if (mod === 2) sum = (sum + 3 * value) | 0;
    if (mod === 3) sum = (sum + 2 * value) | 0;
    if (mod === 4) sum = (sum - Math.trunc(value / 7)) | 0;
    if (mod === 5) sum = (sum - value) | 0;
    else sum = (sum + Math.trunc(value / 3)) | 0;
  }
  return sum;
}

/** Validates the encrypted archive checksum, then applies ReadObjectMask verbatim. */
export function parseObjectMasks(buffer: ArrayBuffer, expectedChecksum?: number): ClassicObjectMasks {
  if (buffer.byteLength !== OBJECT_MASK_BYTES + 4) {
    throw new Error(`object.bin possui ${buffer.byteLength} bytes; esperado ${OBJECT_MASK_BYTES + 4}`);
  }
  const encrypted = new Uint8Array(buffer, 0, OBJECT_MASK_BYTES);
  const encryptedChecksum = calculateObjectMaskChecksum(encrypted);
  const storedChecksum = new DataView(buffer).getInt32(OBJECT_MASK_BYTES, true);
  if (storedChecksum !== encryptedChecksum) {
    throw new Error(`Checksum de object.bin invalido: ${storedChecksum}; calculado ${encryptedChecksum}`);
  }
  if (expectedChecksum !== undefined && expectedChecksum !== encryptedChecksum) {
    throw new Error(`object.bin nao corresponde ao manifesto: ${encryptedChecksum}; esperado ${expectedChecksum}`);
  }

  const values = new Int8Array(OBJECT_MASK_BYTES);
  for (let index = 0; index < encrypted.length; index++) {
    const key = OBJECT_MASK_ENCRYPTION_KEY[index % OBJECT_MASK_ENCRYPTION_KEY.length] ?? 0;
    values[index] = (encrypted[index] ?? 0) - key - index;
  }
  return { values, encryptedChecksum };
}

/** Checksum is intentionally over encrypted signed chars, before decryption. */
export function calculateObjectMaskChecksum(encrypted: ArrayLike<number>): number {
  if (encrypted.length < OBJECT_MASK_BYTES) throw new Error("object.bin truncado");
  let checksum = 0;
  for (let mask = 0; mask < OBJECT_MASK_COUNT; mask++) {
    for (let y = 0; y < OBJECT_MASK_SIDE; y++) {
      const row = mask * OBJECT_MASK_SIDE * OBJECT_MASK_SIDE + y * OBJECT_MASK_SIDE;
      for (let x = 0; x < OBJECT_MASK_SIDE; x++) {
        const value = signedByte(encrypted[row + x] ?? 0);
        checksum = (checksum + (value % 4) + 2 * y + 5 * mask) | 0;
      }
    }
  }
  return checksum;
}

function signedByte(value: number): number {
  const byte = value & 0xff;
  return byte > 127 ? byte - 256 : byte;
}
