import { x25519} from "@noble/curves/ed25519.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"

export interface EphermeralKeyPair {
    secretKey: Uint8Array;
    publicKey: Uint8Array;
}

const SESSION_UUID_INFO = new TextEncoder().encode("session-uuid");
const SESSION_UUID_LENGTH = 32;

export const generateEphermeralKeyPair = (): EphermeralKeyPair => {
    const secretKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(secretKey);
    return { secretKey, publicKey };
}

export const deriveSessionUUID = (mySecret: Uint8Array, theirPublicKey: Uint8Array): Uint8Array => {
    const sharedSecret = x25519.getSharedSecret(mySecret, theirPublicKey);
    return hkdf(sha256, sharedSecret, undefined, SESSION_UUID_INFO, SESSION_UUID_LENGTH);
}

export const computeSessionHash = (sessionUUID: Uint8Array): Uint8Array => {
    return sha256(sessionUUID);
}
