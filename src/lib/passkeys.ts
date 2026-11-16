function b64urlToBuf(value: string): ArrayBuffer {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufToB64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const passkeysSupported = () =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && !!navigator.credentials;

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: { type: 'public-key'; id: string }[];
}

export async function createPasskey(options: RegistrationOptions) {
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: b64urlToBuf(options.challenge),
    rp: options.rp,
    user: { ...options.user, id: b64urlToBuf(options.user.id) },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout ?? 120000,
    attestation: options.attestation ?? 'none',
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: (options.excludeCredentials ?? []).map((cred) => ({ type: cred.type, id: b64urlToBuf(cred.id) })),
  };
  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey refusée.');
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    clientDataJSON: bufToB64url(response.clientDataJSON),
    attestationObject: bufToB64url(response.attestationObject),
  };
}

export interface AssertionOptions {
  challenge: string;
  rpId: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { type: 'public-key'; id: string }[];
}

export async function getPasskeyAssertion(options: AssertionOptions) {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: b64urlToBuf(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout ?? 120000,
    userVerification: options.userVerification ?? 'preferred',
    allowCredentials: (options.allowCredentials ?? []).map((cred) => ({ type: cred.type, id: b64urlToBuf(cred.id) })),
  };
  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Assertion annulée.');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    clientDataJSON: bufToB64url(response.clientDataJSON),
    authenticatorData: bufToB64url(response.authenticatorData),
    signature: bufToB64url(response.signature),
    challenge: options.challenge,
    origin: window.location.origin,
  };
}
