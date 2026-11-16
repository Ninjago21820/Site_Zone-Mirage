import { createHash, createPublicKey, randomBytes, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/**
 * Minimal, dependency-free WebAuthn (passkey) verification for §6.4.
 * Supports attestation `none` and self-attested `packed`, ES256 and EdDSA
 * credential keys — which covers platform passkeys on every major OS.
 */

export interface CoseKey {
  kty: number;
  alg: number;
  crv?: number;
  x: string;
  y?: string;
}

class CborReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  private readLength(additional: number): number {
    if (additional < 24) return additional;
    const bytes = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : -1;
    if (bytes === -1) throw new Error('CBOR_INVALID');
    if (this.offset + bytes > this.buf.length) throw new Error('CBOR_TRUNCATED');
    let value = 0;
    for (let i = 0; i < bytes; i++) value = value * 256 + this.buf[this.offset + i];
    this.offset += bytes;
    return value;
  }

  read(): unknown {
    if (this.offset >= this.buf.length) throw new Error('CBOR_TRUNCATED');
    const initial = this.buf[this.offset++];
    const major = initial >> 5;
    const additional = initial & 31;
    switch (major) {
      case 0:
        return this.readLength(additional);
      case 1:
        return -1 - this.readLength(additional);
      case 2: {
        const len = this.readLength(additional);
        const slice = this.buf.subarray(this.offset, this.offset + len);
        this.offset += len;
        return Buffer.from(slice);
      }
      case 3: {
        const len = this.readLength(additional);
        const slice = this.buf.subarray(this.offset, this.offset + len);
        this.offset += len;
        return slice.toString('utf8');
      }
      case 4: {
        const len = this.readLength(additional);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) arr.push(this.read());
        return arr;
      }
      case 5: {
        const len = this.readLength(additional);
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < len; i++) {
          const key = this.read();
          map.set(key, this.read());
        }
        return map;
      }
      case 6: {
        this.readLength(additional);
        return this.read();
      }
      case 7:
        if (additional === 20) return false;
        if (additional === 21) return true;
        if (additional === 22) return null;
        return this.readLength(additional);
      default:
        throw new Error('CBOR_UNSUPPORTED');
    }
  }
}

export function b64urlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function bufferToB64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function parseCoseKey(raw: Buffer): CoseKey {
  const decoded = new CborReader(raw).read();
  if (!(decoded instanceof Map)) throw new Error('COSE_INVALID');
  const kty = Number(decoded.get(1));
  const alg = Number(decoded.get(3));
  const crv = decoded.get(-1) !== undefined ? Number(decoded.get(-1)) : undefined;
  const x = decoded.get(-2);
  const y = decoded.get(-3);
  if (!(x instanceof Buffer)) throw new Error('COSE_INVALID');
  return {
    kty,
    alg,
    crv,
    x: bufferToB64url(x),
    y: y instanceof Buffer ? bufferToB64url(y) : undefined,
  };
}

export function coseToKeyObject(cose: CoseKey): KeyObject {
  if (cose.kty === 2) {
    if (!cose.y) throw new Error('COSE_INVALID');
    return createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: cose.x, y: cose.y },
      format: 'jwk',
    });
  }
  if (cose.kty === 1) {
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: cose.x }, format: 'jwk' });
  }
  throw new Error('COSE_UNSUPPORTED');
}

export interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  counter: number;
  credentialId?: string;
  coseKey?: CoseKey;
  raw: Buffer;
}

export function parseAuthData(buffer: Buffer): AuthData {
  if (buffer.length < 37) throw new Error('AUTHDATA_TRUNCATED');
  const rpIdHash = buffer.subarray(0, 32);
  const flags = buffer[32];
  const counter = buffer.readUInt32BE(33);
  const result: AuthData = { rpIdHash, flags, counter, raw: buffer };
  if (flags & 0x40) {
    let offset = 37;
    offset += 16; // AAGUID
    if (offset + 2 > buffer.length) throw new Error('AUTHDATA_TRUNCATED');
    const credIdLen = buffer.readUInt16BE(offset);
    offset += 2;
    const credId = buffer.subarray(offset, offset + credIdLen);
    offset += credIdLen;
    result.credentialId = bufferToB64url(credId);
    result.coseKey = parseCoseKey(buffer.subarray(offset));
  }
  return result;
}

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export function parseClientData(clientDataJSON: string | Buffer): ClientData {
  const text = typeof clientDataJSON === 'string' ? clientDataJSON : clientDataJSON.toString('utf8');
  const parsed = JSON.parse(text) as ClientData;
  if (!parsed || typeof parsed.challenge !== 'string' || typeof parsed.type !== 'string') {
    throw new Error('CLIENT_DATA_INVALID');
  }
  return parsed;
}

function hashRpId(rpId: string): Buffer {
  return createHash('sha256').update(rpId).digest();
}

export interface RegistrationInput {
  clientDataJSON: string;
  attestationObject: string;
  challenge: string;
  origin: string;
  rpId: string;
}

export interface RegistrationResult {
  credentialId: string;
  cose: CoseKey;
  counter: number;
  uv: boolean;
  backupEligible: boolean;
}

export function verifyRegistration(input: RegistrationInput): RegistrationResult {
  const clientData = parseClientData(b64urlToBuffer(input.clientDataJSON));
  if (clientData.type !== 'webauthn.create') throw new Error('CLIENT_TYPE_INVALID');
  if (clientData.challenge !== input.challenge) throw new Error('CHALLENGE_MISMATCH');
  if (clientData.origin !== input.origin) throw new Error('ORIGIN_MISMATCH');
  if (clientData.crossOrigin) throw new Error('CROSS_ORIGIN_REJECTED');

  const attObj = new CborReader(b64urlToBuffer(input.attestationObject)).read();
  if (!(attObj instanceof Map)) throw new Error('ATTESTATION_INVALID');
  const fmt = String(attObj.get('fmt') ?? '');
  if (!['none', 'packed', 'fido-u2f', 'tpm', 'apple'].includes(fmt)) throw new Error('ATTESTATION_UNSUPPORTED');
  const authDataRaw = attObj.get('authData');
  if (!(authDataRaw instanceof Buffer)) throw new Error('ATTESTATION_INVALID');
  const authData = parseAuthData(authDataRaw);
  if (!authData.rpIdHash.equals(hashRpId(input.rpId))) throw new Error('RPID_MISMATCH');
  if (!(authData.flags & 0x01)) throw new Error('USER_PRESENCE_REQUIRED');
  if (!authData.credentialId || !authData.coseKey) throw new Error('NO_CREDENTIAL');
  return {
    credentialId: authData.credentialId,
    cose: authData.coseKey,
    counter: authData.counter,
    uv: !!(authData.flags & 0x04),
    backupEligible: !!(authData.flags & 0x08),
  };
}

export interface AssertionInput {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  challenge: string;
  origin: string;
  rpId: string;
  cose: CoseKey;
  storedCounter: number;
}

export interface AssertionResult {
  counter: number;
  uv: boolean;
}

export function verifyAssertion(input: AssertionInput): AssertionResult {
  const clientDataRaw = b64urlToBuffer(input.clientDataJSON);
  const clientData = parseClientData(clientDataRaw);
  if (clientData.type !== 'webauthn.get') throw new Error('CLIENT_TYPE_INVALID');
  if (clientData.challenge !== input.challenge) throw new Error('CHALLENGE_MISMATCH');
  if (clientData.origin !== input.origin) throw new Error('ORIGIN_MISMATCH');
  if (clientData.crossOrigin) throw new Error('CROSS_ORIGIN_REJECTED');

  const authDataRaw = b64urlToBuffer(input.authenticatorData);
  const authData = parseAuthData(authDataRaw);
  if (!authData.rpIdHash.equals(hashRpId(input.rpId))) throw new Error('RPID_MISMATCH');
  if (!(authData.flags & 0x01)) throw new Error('USER_PRESENCE_REQUIRED');

  const clientDataHash = createHash('sha256').update(clientDataRaw).digest();
  const signedData = Buffer.concat([authDataRaw, clientDataHash]);
  const signature = b64urlToBuffer(input.signature);
  const key = coseToKeyObject(input.cose);

  let valid = false;
  if (input.cose.kty === 1) {
    valid = cryptoVerify(null, signedData, key, signature);
  } else {
    valid = cryptoVerify('sha256', signedData, { key, dsaEncoding: 'der' }, signature);
  }
  if (!valid) throw new Error('SIGNATURE_INVALID');

  // Counter must strictly increase unless the authenticator reports 0 (platform passkeys).
  if (authData.counter !== 0 && authData.counter <= input.storedCounter) throw new Error('COUNTER_REPLAY');
  return { counter: authData.counter || input.storedCounter, uv: !!(authData.flags & 0x04) };
}

export const newChallenge = () => randomBytes(32).toString('base64url');

export function registrationOptions(params: {
  rpId: string;
  rpName: string;
  userId: string;
  userName: string;
  excludeCredentials: string[];
}) {
  return {
    challenge: newChallenge(),
    rp: { id: params.rpId, name: params.rpName },
    user: {
      id: bufferToB64url(Buffer.from(params.userId)),
      name: params.userName,
      displayName: params.userName,
    },
    pubKeyCredParams: [
      { type: 'public-key' as const, alg: -7 },
      { type: 'public-key' as const, alg: -8 },
    ],
    timeout: 120000,
    attestation: 'none' as const,
    authenticatorSelection: {
      residentKey: 'preferred' as const,
      userVerification: 'preferred' as const,
    },
    excludeCredentials: params.excludeCredentials.map((id) => ({ type: 'public-key' as const, id })),
  };
}

export function assertionOptions(params: { rpId: string; challenge: string; allowCredentials: string[] }) {
  return {
    challenge: params.challenge,
    rpId: params.rpId,
    timeout: 120000,
    userVerification: 'preferred' as const,
    allowCredentials: params.allowCredentials.map((id) => ({ type: 'public-key' as const, id })),
  };
}
