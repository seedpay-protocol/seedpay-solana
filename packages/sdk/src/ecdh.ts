import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const HKDF_CONTEXT = new TextEncoder().encode("seedpay-v1-session");

export interface EphemeralKeypair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface SessionKeys {
  sharedSecret: Uint8Array;
  sessionUUID: Uint8Array;
  channelId: Uint8Array;
}

export const generateEphemeralKeypair = (): EphemeralKeypair => {
  const secretKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(secretKey);
  return { secretKey, publicKey };
};

export const deriveSessionKeys = (
  mySecretKey: Uint8Array,
  theirPublicKey: Uint8Array,
): SessionKeys => {
  const sharedSecret = x25519.getSharedSecret(mySecretKey, theirPublicKey);

  const sessionUUID = hkdf(sha256, sharedSecret, undefined, HKDF_CONTEXT, 32);

  const channelId = sha256(sessionUUID);

  return { sharedSecret, sessionUUID, channelId };
};

export const computeChannelId = (sessionUUID: Uint8Array): Uint8Array => {
  return sha256(sessionUUID);
};
