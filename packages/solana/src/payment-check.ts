import {sha256} from "@noble/hashes/sha2.js"
import nacl from "tweetnacl"
import type {KeyPairSigner} from "@solana/kit"

export interface PaymentCheck {
    channelId: Uint8Array;
    amount: bigint;
    nonce: number;
    signature: Uint8Array;
}

export const createPaymentCheckMessage = (
    channelId: Uint8Array,
    amount: bigint,
    nonce: number,
): Uint8Array => {
    const message = new Uint8Array(channelId.length + 8 + 8);
    message.set(channelId, 0);

    const view = new DataView(message.buffer);
    view.setBigUint64(32, amount, true);
    view.setUint32(40, nonce, true);

    return message;
}

export const signPaymentCheck = (
    channelId: Uint8Array,
    amount: bigint,
    nonce: number,
    secretKey: Uint8Array
): PaymentCheck => {
    const message = createPaymentCheckMessage(channelId, amount, nonce);
    const messageHash = sha256(message);
    const signature = nacl.sign.detached(messageHash, secretKey);
    return {
        channelId,
        amount,
        nonce,
        signature,
    };
}

export const verifyPaymentCheck = (
    check: PaymentCheck,
    signerPublicKey: Uint8Array
): boolean => {
    const message = createPaymentCheckMessage(check.channelId, check.amount, check.nonce);
    const messageHash = sha256(message);
    return nacl.sign.detached.verify(messageHash, check.signature, signerPublicKey)
};