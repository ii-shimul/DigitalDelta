import * as nacl from 'tweetnacl';

type FieldElement = Float64Array;

const gf = (init?: number[]): FieldElement => {
  const result = new Float64Array(16);
  if (init) {
    for (let index = 0; index < init.length; index += 1) {
      result[index] = init[index];
    }
  }

  return result;
};

const GF_ZERO = gf();
const GF_ONE = gf([1]);
const D = gf([
  0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898,
  0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203,
]);
const I = gf([
  0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7,
  0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83,
]);

export function convertPublicKey(pk: Uint8Array): Uint8Array | null {
  const z = new Uint8Array(32);
  const q = [gf(), gf(), gf(), gf()];
  const a = gf();
  const b = gf();

  if (unpackNegative(q, pk)) {
    return null;
  }

  const y = q[1];
  add(a, GF_ONE, y);
  subtract(b, GF_ONE, y);
  invert25519(b, b);
  multiply(a, a, b);
  pack25519(z, a);

  return z;
}

export function convertSecretKey(sk: Uint8Array): Uint8Array {
  const digest = new Uint8Array(64);
  const output = new Uint8Array(32);

  const lowlevel = (nacl as typeof nacl & {
    lowlevel?: {
      crypto_hash(output: Uint8Array, message: Uint8Array, length: number): void;
    };
  }).lowlevel;

  if (!lowlevel?.crypto_hash) {
    throw new Error('tweetnacl lowlevel crypto_hash is unavailable.');
  }

  lowlevel.crypto_hash(digest, sk, 32);
  digest[0] &= 248;
  digest[31] &= 127;
  digest[31] |= 64;

  for (let index = 0; index < 32; index += 1) {
    output[index] = digest[index];
  }

  digest.fill(0);
  return output;
}

function carry25519(output: FieldElement): void {
  for (let index = 0; index < 16; index += 1) {
    output[index] += 65536;
    const carry = Math.floor(output[index] / 65536);
    output[(index + 1) * (index < 15 ? 1 : 0)] +=
      carry - 1 + 37 * (carry - 1) * (index === 15 ? 1 : 0);
    output[index] -= carry * 65536;
  }
}

function select25519(a: FieldElement, b: FieldElement, bit: number): void {
  const mask = ~(bit - 1);

  for (let index = 0; index < 16; index += 1) {
    const temp = mask & (a[index] ^ b[index]);
    a[index] ^= temp;
    b[index] ^= temp;
  }
}

function unpack25519(output: FieldElement, input: Uint8Array): void {
  for (let index = 0; index < 16; index += 1) {
    output[index] = input[2 * index] + (input[2 * index + 1] << 8);
  }

  output[15] &= 0x7fff;
}

function add(output: FieldElement, left: FieldElement, right: FieldElement): void {
  for (let index = 0; index < 16; index += 1) {
    output[index] = (left[index] + right[index]) | 0;
  }
}

function subtract(
  output: FieldElement,
  left: FieldElement,
  right: FieldElement,
): void {
  for (let index = 0; index < 16; index += 1) {
    output[index] = (left[index] - right[index]) | 0;
  }
}

function multiply(
  output: FieldElement,
  left: FieldElement,
  right: FieldElement,
): void {
  const temp = new Float64Array(31);

  for (let i = 0; i < 16; i += 1) {
    for (let j = 0; j < 16; j += 1) {
      temp[i + j] += left[i] * right[j];
    }
  }

  for (let index = 0; index < 15; index += 1) {
    temp[index] += 38 * temp[index + 16];
  }

  for (let index = 0; index < 16; index += 1) {
    output[index] = temp[index];
  }

  carry25519(output);
  carry25519(output);
}

function square(output: FieldElement, input: FieldElement): void {
  multiply(output, input, input);
}

function invert25519(output: FieldElement, input: FieldElement): void {
  const copied = gf();

  for (let index = 0; index < 16; index += 1) {
    copied[index] = input[index];
  }

  for (let power = 253; power >= 0; power -= 1) {
    square(copied, copied);
    if (power !== 2 && power !== 4) {
      multiply(copied, copied, input);
    }
  }

  for (let index = 0; index < 16; index += 1) {
    output[index] = copied[index];
  }
}

function pack25519(output: Uint8Array, input: FieldElement): void {
  const minus = gf();
  const temp = gf();

  for (let index = 0; index < 16; index += 1) {
    temp[index] = input[index];
  }

  carry25519(temp);
  carry25519(temp);
  carry25519(temp);

  for (let round = 0; round < 2; round += 1) {
    minus[0] = temp[0] - 0xffed;

    for (let index = 1; index < 15; index += 1) {
      minus[index] = temp[index] - 0xffff - ((minus[index - 1] >> 16) & 1);
      minus[index - 1] &= 0xffff;
    }

    minus[15] = temp[15] - 0x7fff - ((minus[14] >> 16) & 1);
    const bit = (minus[15] >> 16) & 1;
    minus[14] &= 0xffff;
    select25519(temp, minus, 1 - bit);
  }

  for (let index = 0; index < 16; index += 1) {
    output[2 * index] = temp[index] & 0xff;
    output[2 * index + 1] = temp[index] >> 8;
  }
}

function parity25519(input: FieldElement): number {
  const packed = new Uint8Array(32);
  pack25519(packed, input);
  return packed[0] & 1;
}

function verifyN(
  left: Uint8Array,
  leftIndex: number,
  right: Uint8Array,
  rightIndex: number,
  length: number,
): number {
  let delta = 0;

  for (let index = 0; index < length; index += 1) {
    delta |= left[leftIndex + index] ^ right[rightIndex + index];
  }

  return (1 & ((delta - 1) >>> 8)) - 1;
}

function notEqual25519(left: FieldElement, right: FieldElement): number {
  const packedLeft = new Uint8Array(32);
  const packedRight = new Uint8Array(32);

  pack25519(packedLeft, left);
  pack25519(packedRight, right);
  return verifyN(packedLeft, 0, packedRight, 0, 32);
}

function power2523(output: FieldElement, input: FieldElement): void {
  const copied = gf();

  for (let index = 0; index < 16; index += 1) {
    copied[index] = input[index];
  }

  for (let power = 250; power >= 0; power -= 1) {
    square(copied, copied);
    if (power !== 1) {
      multiply(copied, copied, input);
    }
  }

  for (let index = 0; index < 16; index += 1) {
    output[index] = copied[index];
  }
}

function set25519(output: FieldElement, input: FieldElement): void {
  for (let index = 0; index < 16; index += 1) {
    output[index] = input[index] | 0;
  }
}

function unpackNegative(result: FieldElement[], input: Uint8Array): number {
  const temp = gf();
  const check = gf();
  const numerator = gf();
  const denominator = gf();
  const denominator2 = gf();
  const denominator4 = gf();
  const denominator6 = gf();

  set25519(result[2], GF_ONE);
  unpack25519(result[1], input);
  square(numerator, result[1]);
  multiply(denominator, numerator, D);
  subtract(numerator, numerator, result[2]);
  add(denominator, result[2], denominator);

  square(denominator2, denominator);
  square(denominator4, denominator2);
  multiply(denominator6, denominator4, denominator2);
  multiply(temp, denominator6, numerator);
  multiply(temp, temp, denominator);
  power2523(temp, temp);
  multiply(temp, temp, numerator);
  multiply(temp, temp, denominator);
  multiply(temp, temp, denominator);
  multiply(result[0], temp, denominator);

  square(check, result[0]);
  multiply(check, check, denominator);
  if (notEqual25519(check, numerator)) {
    multiply(result[0], result[0], I);
  }

  square(check, result[0]);
  multiply(check, check, denominator);
  if (notEqual25519(check, numerator)) {
    return -1;
  }

  if (parity25519(result[0]) === (input[31] >> 7)) {
    subtract(result[0], GF_ZERO, result[0]);
  }

  multiply(result[3], result[0], result[1]);
  return 0;
}