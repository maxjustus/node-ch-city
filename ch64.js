// This is a chatGPT o1/claude translation of the ClickHouse specific implementation of cityHash64
// as found here: https://github.com/go-faster/city/blob/main/ch_64.go
//
// it's reasonably fast. 10 million iterations of a 4 character string took
// 1.5 seconds on my m4 max machine.
//
// test vals:
// value: asdf3
// js hash: 14016960382098508583
// clickhouse cityHash64() hash: 14016960382098508583
//
// value: 4994593
// js hash: 4598645670525206072
// clickhouse cityHash64() hash: 4598645670525206072

/**
 * Constants used in the CityHash64 algorithm
 * @constant {bigint}
 */
const k0 = 0xc3a5c85c97cb3127n;
const k1 = 0xb492b66fbe98f273n;
const k2 = 0x9ae16a3b2f90404fn;
const k3 = 0xc949d7c7509e6557n;

/**
 * Performs a 64-bit modulo operation
 * @param {bigint} n - Number to perform modulo on
 * @returns {bigint} Result of modulo operation
 */
const mod64 = n => n & 0xffffffffffffffffn;

/**
 * Performs a 64-bit rotation
 * @param {bigint} val - Value to rotate
 * @param {number|bigint} shift - Number of bits to rotate by
 * @returns {bigint} Rotated value
 */
function rot64 (val, shift) {
  shift = BigInt(shift);

  if (shift === 0n) return val;

  return mod64((val >> shift) | (val << (64n - shift)));
}

/**
 * Performs a shift mix operation
 * @param {bigint} val - Value to mix
 * @returns {bigint} Mixed value
 */
const shiftMix = val => val ^ (val >> 47n);

/**
 * Hashes two 64-bit numbers into a single 64-bit hash
 * @param {bigint} low - Lower 64 bits
 * @param {bigint} high - Higher 64 bits
 * @returns {bigint} Combined hash
 */
function hash128to64 (low, high) {
  const mul = 0x9ddfea08eb382d69n;
  let a = mod64((low ^ high) * mul);
  a ^= a >> 47n;
  let b = mod64((high ^ a) * mul);
  b ^= b >> 47n;
  b = mod64(b * mul);

  return b;
}

/**
 * Simple wrapper for hash128to64
 * @param {bigint} u - First value
 * @param {bigint} v - Second value
 * @returns {bigint} Hash result
 */
const ch16 = (u, v) => hash128to64(u, v);

/**
 * @typedef {Object} Hash32Result
 * @property {bigint} Low - Lower 64 bits of hash
 * @property {bigint} High - Higher 64 bits of hash
 */

/**
 * Computes a weak hash from multiple 64-bit seeds
 * @param {bigint} w - First seed
 * @param {bigint} x - Second seed
 * @param {bigint} y - Third seed
 * @param {bigint} z - Fourth seed
 * @param {bigint} a - Fifth seed
 * @param {bigint} b - Sixth seed
 * @returns {Hash32Result} Result containing Low and High components
 */
function weakHash32Seeds (w, x, y, z, a, b) {
  a = mod64(a + w);
  b = rot64(mod64(b + a + z), 21);
  const c = a;
  a = mod64(a + x + y);
  b = mod64(b + rot64(a, 44));

  return { Low: mod64(a + z), High: mod64(b + c) };
}

/**
 * Fetches a 32-bit number from a buffer at specified offset
 * @param {Buffer} buf - Buffer to read from
 * @param {number} offset - Offset to read at
 * @returns {bigint} 32-bit value as bigint
 */
const fetch32 = (buf, offset) => BigInt(buf.readUInt32LE(offset));

/**
 * Fetches a 64-bit number from a buffer at specified offset
 * @param {Buffer} buf - Buffer to read from
 * @param {number} offset - Offset to read at
 * @returns {bigint} 64-bit value
 */
const fetch64 = (buf, offset) => buf.readBigUInt64LE(offset);

/**
 * Computes a weak hash from a buffer section
 * @param {Buffer} buf - Input buffer
 * @param {number} offset - Offset to start reading from
 * @param {bigint} a - First seed
 * @param {bigint} b - Second seed
 * @returns {Hash32Result} Result containing Low and High components
 */
const weakHash32SeedsByte = (buf, offset, a, b) => weakHash32Seeds(
  fetch64(buf, offset),
  fetch64(buf, offset + 8),
  fetch64(buf, offset + 16),
  fetch64(buf, offset + 24),
  a,
  b
);

/**
 * Hashes short strings (0-16 bytes)
 * @param {Buffer} s - Input buffer
 * @param {number} length - Length of input
 * @returns {bigint} Hash value
 */
function ch0to16 (s, length) {
  if (length > 8) {
    const a = fetch64(s, 0);
    const b = fetch64(s, length - 8);

    return ch16(a, rot64(mod64(b + BigInt(length)), BigInt(length))) ^ b;
  }
  if (length >= 4) {
    const a = BigInt(fetch32(s, 0));

    return ch16(BigInt(length) + (a << 3n), BigInt(fetch32(s, length - 4)));
  }
  if (length > 0) {
    const a = BigInt(s[0]);
    const b = BigInt(s[length >> 1]);
    const c = BigInt(s[length - 1]);
    const y = a + (b << 8n);
    const z = BigInt(length) + (c << 2n);

    return mod64(shiftMix(mod64(y * k2) ^ mod64(z * k3)) * k2);
  }

  return k2;
}

/**
 * Another wrapper for hash128to64
 * @param {bigint} u - First value
 * @param {bigint} v - Second value
 * @returns {bigint} Hash result
 */
const hash16 = (u, v) => hash128to64(u, v);

/**
 * Hashes medium-length strings (17-32 bytes)
 * @param {Buffer} s - Input buffer
 * @param {number} length - Length of input
 * @returns {bigint} Hash value
 */
function ch17to32 (s, length) {
  const a = mod64(fetch64(s, 0) * k1);
  const b = fetch64(s, 8);
  const c = mod64(fetch64(s, length - 8) * k2);
  const d = mod64(fetch64(s, length - 16) * k0);

  return hash16(
    rot64(a - b, 43) + rot64(c, 30) + d,
    a + rot64(b ^ k3, 20) - c + BigInt(length)
  );
}

/**
 * Hashes medium-length strings (33-64 bytes)
 * @param {Buffer} s - Input buffer
 * @param {number} length - Length of input
 * @returns {bigint} Hash value
 */
function ch33to64 (s, length) {
  let z = fetch64(s, 24);
  let a = fetch64(s, 0) + (BigInt(length) + fetch64(s, length - 16)) * k0;
  a = mod64(a);
  let b = rot64(a + z, 52);
  let c = rot64(a, 37);
  a = mod64(a + fetch64(s, 8));
  c = mod64(c + rot64(a, 7));
  a = mod64(a + fetch64(s, 16));
  const vf = a + z;
  const vs = b + rot64(a, 31) + c;

  a = fetch64(s, 16) + fetch64(s, length - 32);
  z = fetch64(s, length - 8);
  b = rot64(a + z, 52);
  c = rot64(a, 37);
  a = mod64(a + fetch64(s, length - 24));
  c = mod64(c + rot64(a, 7));
  a = mod64(a + fetch64(s, length - 16));
  const wf = a + z;
  const ws = b + rot64(a, 31) + c;
  const r = shiftMix(mod64(vf + ws) * k2 + mod64(wf + vs) * k0);

  return mod64(shiftMix(mod64(r * k0) + vs) * k2);
}

/**
 * Finds the nearest multiple of 64 less than the input
 * @param {number} len - Input length
 * @returns {number} Nearest multiple of 64
 */
const nearestMultiple64 = len => (len - 1) & ~63;

/**
 * CityHash64 implementation
 * A fast non-cryptographic hash function for strings
 *
 * @param {Buffer | string} buf - Input data to hash
 * @returns {bigint} 64-bit hash value
 *
 * @example
 * const hash = CH64("hello world");
 * console.log(hash.toString());
 *
 * @example
 * const buf = Buffer.from([1, 2, 3, 4]);
 * const hash = CH64(buf);
 */
function CH64 (buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);

  const length = buf.length;

  if (length <= 16) return ch0to16(buf, length);
  if (length <= 32) return ch17to32(buf, length);
  if (length <= 64) return ch33to64(buf, length);

  let x = fetch64(buf, 0);
  let y = fetch64(buf, length - 16) ^ k1;
  let z = fetch64(buf, length - 56) ^ k0;

  let v = weakHash32SeedsByte(buf, length - 64, BigInt(length), y);
  let w = weakHash32SeedsByte(buf, length - 32, BigInt(length) * k1, k0);
  z = z + shiftMix(v.High) * k1;
  z = mod64(z);
  x = rot64(z + x, 39) * k1;
  x = mod64(x);
  y = rot64(y, 33) * k1;
  y = mod64(y);

  const end = nearestMultiple64(length);
  let pos = 0;
  while (pos < end) {
    x = rot64(x + y + v.Low + fetch64(buf, pos + 16), 37) * k1;
    x = mod64(x);
    y = rot64(y + v.High + fetch64(buf, pos + 48), 42) * k1;
    y = mod64(y);
    x ^= w.High;
    y ^= v.Low;
    z = rot64(z ^ w.Low, 33);
    v = weakHash32SeedsByte(buf, pos, v.High * k1, x + w.Low);
    w = weakHash32SeedsByte(buf, pos + 32, z + w.High, y);
    const tmp = z;
    z = x;
    x = tmp;
    pos += 64;
  }

  return ch16(
    ch16(v.Low, w.Low) + shiftMix(y) * k1 + z,
    ch16(v.High, w.High) + x
  );
}

module.exports = CH64;
