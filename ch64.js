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
//
// Also tested with fuzzing against a few million random strings with lengths between 2 and 200
// to ensure it matches the output of cityHash64 in ClickHouse.

const k0 = 0xc3a5c85c97cb3127n;
const k1 = 0xb492b66fbe98f273n;
const k2 = 0x9ae16a3b2f90404fn;
const k3 = 0xc949d7c7509e6557n;

const mod64 = (n) => n & 0xffffffffffffffffn;

function rot64(val, shift) {
  shift = shift & 63n;

  if (shift === 0n) return val;

  // Rotate right
  const right = val >> shift;
  const left = mod64(val << (64n - shift));

  return mod64(right | left);
}

function shiftMix(val) {
  val = mod64(val);

  return mod64(val ^ (val >> 47n));
}

function hash128to64(low, high) {
  const mul = 0x9ddfea08eb382d69n;
  let a = mod64((low ^ high) * mul);
  a = mod64(a ^ (a >> 47n));
  let b = mod64((high ^ a) * mul);
  b = mod64(b ^ (b >> 47n));
  b = mod64(b * mul);

  return b;
}

const ch16 = (u, v) => hash128to64(u, v);

function weakHash32Seeds(w, x, y, z, a, b) {
  a = mod64(a + w);
  b = rot64(mod64(b + a + z), 21n);
  const c = a;
  a = mod64(a + x + y);
  b = mod64(b + rot64(a, 44n));

  return { Low: mod64(a + z), High: mod64(b + c) };
}

const fetch32 = (buf, offset) => BigInt(buf.readUInt32LE(offset));

const fetch64 = (buf, offset) => buf.readBigUInt64LE(offset);

const weakHash32SeedsByte = (buf, offset, a, b) =>
  weakHash32Seeds(
    fetch64(buf, offset),
    fetch64(buf, offset + 8),
    fetch64(buf, offset + 16),
    fetch64(buf, offset + 24),
    a,
    b,
  );

function ch0to16(s, length) {
  if (length > 8) {
    const a = fetch64(s, 0);
    const b = fetch64(s, length - 8);
    const val = ch16(a, rot64(mod64(b + BigInt(length)), BigInt(length))) ^ b;

    return mod64(val);
  }
  if (length >= 4) {
    const a = BigInt(fetch32(s, 0));

    return mod64(
      ch16(mod64(BigInt(length) + (a << 3n)), BigInt(fetch32(s, length - 4))),
    );
  }
  if (length > 0) {
    const a = BigInt(s[0]);
    const b = BigInt(s[length >> 1]);
    const c = BigInt(s[length - 1]);
    const y = mod64(a + (b << 8n));
    const z = mod64(BigInt(length) + (c << 2n));

    return mod64(shiftMix(mod64(y * k2) ^ mod64(z * k3)) * k2);
  }

  return k2;
}

function ch17to32(s, length) {
  const a = mod64(fetch64(s, 0) * k1);
  const b = fetch64(s, 8);
  const c = mod64(fetch64(s, length - 8) * k2);
  const d = mod64(fetch64(s, length - 16) * k0);
  const val1 = mod64(rot64(mod64(a - b), 43n) + rot64(c, 30n) + d);
  const val2 = mod64(a + rot64(b ^ k3, 20n) - c + BigInt(length));

  return mod64(ch16(val1, val2));
}

function ch33to64(s, length) {
  let z = fetch64(s, 24);
  let a = mod64(
    fetch64(s, 0) + mod64((BigInt(length) + fetch64(s, length - 16)) * k0),
  );
  let b = rot64(mod64(a + z), 52n);
  let c = rot64(a, 37n);
  a = mod64(a + fetch64(s, 8));
  c = mod64(c + rot64(a, 7n));
  a = mod64(a + fetch64(s, 16));
  const vf = mod64(a + z);
  const vs = mod64(b + rot64(a, 31n) + c);

  a = mod64(fetch64(s, 16) + fetch64(s, length - 32));
  z = fetch64(s, length - 8);
  b = rot64(mod64(a + z), 52n);
  c = rot64(a, 37n);
  a = mod64(a + fetch64(s, length - 24));
  c = mod64(c + rot64(a, 7n));
  a = mod64(a + fetch64(s, length - 16));

  const wf = mod64(a + z);
  const ws = mod64(b + rot64(a, 31n) + c);
  let r = mod64(mod64(vf + ws) * k2 + mod64(wf + vs) * k0);
  r = shiftMix(r);
  r = mod64(shiftMix(mod64(r * k0) + vs) * k2);

  return r;
}

// Same logic as Go code: (len-1)&^63 clears lower 6 bits
const nearestMultiple64 = (len) => (len - 1) & ~63;

/** @param {string} input */
function CH64(input) {
  let buf;

  if (!Buffer.isBuffer(input)) {
    buf = Buffer.from(input);
  } else {
    buf = input;
  }

  const length = buf.length;

  if (length <= 16) {
    return ch0to16(buf, length);
  } else if (length <= 32) {
    return ch17to32(buf, length);
  } else if (length <= 64) {
    return ch33to64(buf, length);
  }

  let x = fetch64(buf, 0);
  let y = mod64(fetch64(buf, length - 16) ^ k1);
  let z = mod64(fetch64(buf, length - 56) ^ k0);

  let v = weakHash32SeedsByte(buf, length - 64, BigInt(length), y);
  let w = weakHash32SeedsByte(buf, length - 32, mod64(BigInt(length) * k1), k0);
  z = mod64(z + mod64(shiftMix(v.High)) * k1);
  x = mod64(rot64(mod64(z + x), 39n) * k1);
  y = mod64(rot64(y, 33n) * k1);

  let data = buf.subarray(0, nearestMultiple64(length));

  while (data.length > 0) {
    x = mod64(rot64(mod64(x + y + v.Low + fetch64(data, 16)), 37n) * k1);
    y = mod64(rot64(mod64(y + v.High + fetch64(data, 48)), 42n) * k1);

    x = mod64(x ^ w.High);
    y = mod64(y ^ v.Low);
    z = rot64(mod64(z ^ w.Low), 33n);

    v = weakHash32SeedsByte(data, 0, mod64(v.High * k1), mod64(x + w.Low));

    w = weakHash32SeedsByte(data.subarray(32), 0, mod64(z + w.High), y);

    const tmp = z;
    z = x;
    x = tmp;

    data = data.subarray(64);
  }

  const t1 = mod64(ch16(v.Low, w.Low) + mod64(shiftMix(y) * k1) + z);
  const t2 = mod64(ch16(v.High, w.High) + x);

  return mod64(ch16(t1, t2));
}

module.exports = CH64;
