import nacl from "tweetnacl";

export interface PaymentCheck {
  channelId: Uint8Array;
  amount: bigint;
  nonce: bigint;
  signature: Uint8Array;
}

export const encodePaymentCheckMessage = (
  channelId: Uint8Array,
  amount: bigint,
  nonce: bigint,
): Uint8Array => {
  const message = new Uint8Array(48);

  message.set(channelId, 0); // 0-32 bytes

  const amountView = new DataView(message.buffer, 32, 8);
  amountView.setBigUint64(0, amount, true); // 32-40 bytes

  const nonceView = new DataView(message.buffer, 40, 8);
  nonceView.setBigUint64(0, nonce, true);

  return message;
};

export const signPaymentCheck = (
  channelId: Uint8Array,
  amount: bigint,
  nonce: bigint,
  secretKey: Uint8Array,
): PaymentCheck => {
  const message = encodePaymentCheckMessage(channelId, amount, nonce);
  const signature = nacl.sign.detached(message, secretKey);

  return { channelId, amount, nonce, signature };
};

export const verifyPaymentCheck = (
  check: PaymentCheck,
  publicKey: Uint8Array,
): boolean => {
  const message = encodePaymentCheckMessage(
    check.channelId,
    check.amount,
    check.nonce,
  );

  return nacl.sign.detached.verify(message, check.signature, publicKey);
};
