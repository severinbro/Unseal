import crypto from 'node:crypto';
import { Algorithm, hash, hashSync, verify } from '@node-rs/argon2';

import { AUTH_LIMITS } from '@entsiegelung/shared';

import { BoundedSemaphore } from '../util/semaphore.js';

const ARGON2ID_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DEFAULT_AUTH_SEMAPHORE = new BoundedSemaphore(4, 20, 'AUTH_BUSY');

export const TIMING_GUARD_PASSWORD_HASH: string = hashSync(
  crypto.randomBytes(32),
  ARGON2ID_OPTIONS,
);

export const TIMING_GUARD_OPAQUE_TOKEN_HASH: Buffer = crypto
  .createHash('sha256')
  .update(crypto.randomBytes(32))
  .digest();

export async function hashPassword(
  password: string,
  semaphore: BoundedSemaphore = DEFAULT_AUTH_SEMAPHORE,
): Promise<string> {
  return semaphore.run(() => hash(password, ARGON2ID_OPTIONS));
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
  semaphore: BoundedSemaphore = DEFAULT_AUTH_SEMAPHORE,
): Promise<boolean> {
  return semaphore.run(async () => {
    if (!passwordHash.startsWith('$argon2')) {
      return false;
    }
    try {
      return await verify(passwordHash, password, ARGON2ID_OPTIONS);
    } catch (err: unknown) {
      if (err instanceof Error) {
        return false;
      }
      return false;
    }
  });
}

export function generateRecoveryCode(): string {
  const rawHex = crypto
    .randomBytes(AUTH_LIMITS.RECOVERY_CODE_BYTES)
    .toString('hex')
    .toUpperCase();
  const groups: string[] = [];
  for (let offset = 0; offset < rawHex.length; offset += 4) {
    groups.push(rawHex.slice(offset, offset + 4));
  }
  return groups.join('-');
}

export function hashOpaqueToken(normalized: string): Buffer {
  return crypto.createHash('sha256').update(normalized, 'utf8').digest();
}

export function verifyOpaqueToken(
  normalizedCandidate: string,
  storedDigest: Uint8Array,
): boolean {
  const candidateDigest = hashOpaqueToken(normalizedCandidate);
  if (candidateDigest.byteLength !== storedDigest.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(candidateDigest, storedDigest);
}

export function hashPseudonymTombstone(pseudonymLower: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(pseudonymLower.toLowerCase(), 'utf8')
    .digest();
}

export function hashEmailTombstone(emailLower: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(`email:${emailLower.trim().toLowerCase()}`, 'utf8')
    .digest();
}

export function generateEmailActionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
