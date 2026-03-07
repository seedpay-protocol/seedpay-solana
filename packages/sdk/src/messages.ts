import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { PaymentCheck } from "./payment-check";

// --- Message Types ---

export interface EcdhInitMessage {
  type: "ecdh_init";
  publicKey: Uint8Array;
}

export interface ChannelOpenedMessage {
  type: "channel_opened";
  channelId: Uint8Array;
  txSignature: string;
  deposited: bigint;
  timeout: bigint;
}

export interface ChannelConfirmedMessage {
  type: "channel_confirmed";
  channelId: Uint8Array;
}

export interface ChannelRejectedMessage {
  type: "channel_rejected";
  channelId: Uint8Array;
  reason: string;
}

export interface PaymentCheckMessage {
  type: "payment_check";
  channelId: Uint8Array;
  amount: bigint;
  nonce: bigint;
  signature: Uint8Array;
}

export interface PaymentCheckRequiredMessage {
  type: "payment_check_required";
  amountOwed: bigint;
}

export interface PaymentCheckRejectedMessage {
  type: "payment_check_rejected";
  reason: string;
}

export interface ChannelClosedMessage {
  type: "channel_closed";
  channelId: Uint8Array;
  txSignature: string;
}

export interface ChannelTimeoutWarningMessage {
  type: "channel_timeout_warning";
  channelId: Uint8Array;
  timeoutAt: bigint;
}

export type SeedPayMessage =
  | EcdhInitMessage
  | ChannelOpenedMessage
  | ChannelConfirmedMessage
  | ChannelRejectedMessage
  | PaymentCheckMessage
  | PaymentCheckRequiredMessage
  | PaymentCheckRejectedMessage
  | ChannelClosedMessage
  | ChannelTimeoutWarningMessage;

export type SeedPayMessageType = SeedPayMessage["type"];

const MESSAGE_TYPES: Set<string> = new Set([
  "ecdh_init",
  "channel_opened",
  "channel_confirmed",
  "channel_rejected",
  "payment_check",
  "payment_check_required",
  "payment_check_rejected",
  "channel_closed",
  "channel_timeout_warning",
]);

// --- Encode/Decode ---

export const encodeMessage = (
  msg: SeedPayMessage,
): Record<string, unknown> => {
  switch (msg.type) {
    case "ecdh_init":
      return { type: msg.type, publicKey: bytesToHex(msg.publicKey) };

    case "channel_opened":
      return {
        type: msg.type,
        channelId: bytesToHex(msg.channelId),
        txSignature: msg.txSignature,
        deposited: msg.deposited.toString(),
        timeout: msg.timeout.toString(),
      };

    case "channel_confirmed":
      return { type: msg.type, channelId: bytesToHex(msg.channelId) };

    case "channel_rejected":
      return {
        type: msg.type,
        channelId: bytesToHex(msg.channelId),
        reason: msg.reason,
      };

    case "payment_check":
      return {
        type: msg.type,
        channelId: bytesToHex(msg.channelId),
        amount: msg.amount.toString(),
        nonce: msg.nonce.toString(),
        signature: bytesToHex(msg.signature),
      };

    case "payment_check_required":
      return { type: msg.type, amountOwed: msg.amountOwed.toString() };

    case "payment_check_rejected":
      return { type: msg.type, reason: msg.reason };

    case "channel_closed":
      return {
        type: msg.type,
        channelId: bytesToHex(msg.channelId),
        txSignature: msg.txSignature,
      };

    case "channel_timeout_warning":
      return {
        type: msg.type,
        channelId: bytesToHex(msg.channelId),
        timeoutAt: msg.timeoutAt.toString(),
      };
  }
};

export const decodeMessage = (
  obj: Record<string, unknown>,
): SeedPayMessage => {
  const type = obj.type;
  if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) {
    throw new Error(`Unknown message type: ${String(type)}`);
  }

  switch (type) {
    case "ecdh_init":
      return {
        type,
        publicKey: hexToBytes(requireString(obj, "publicKey")),
      };

    case "channel_opened":
      return {
        type,
        channelId: hexToBytes(requireString(obj, "channelId")),
        txSignature: requireString(obj, "txSignature"),
        deposited: BigInt(requireString(obj, "deposited")),
        timeout: BigInt(requireString(obj, "timeout")),
      };

    case "channel_confirmed":
      return {
        type,
        channelId: hexToBytes(requireString(obj, "channelId")),
      };

    case "channel_rejected":
      return {
        type,
        channelId: hexToBytes(requireString(obj, "channelId")),
        reason: requireString(obj, "reason"),
      };

    case "payment_check":
      return {
        type,
        channelId: hexToBytes(requireString(obj, "channelId")),
        amount: BigInt(requireString(obj, "amount")),
        nonce: BigInt(requireString(obj, "nonce")),
        signature: hexToBytes(requireString(obj, "signature")),
      };

    case "payment_check_required":
      return {
        type,
        amountOwed: BigInt(requireString(obj, "amountOwed")),
      };

    case "payment_check_rejected":
      return { type, reason: requireString(obj, "reason") };

    case "channel_closed":
      return {
        type,
        channelId: hexToBytes(requireString(obj, "channelId")),
        txSignature: requireString(obj, "txSignature"),
      };

    case "channel_timeout_warning":
      return {
        type,
        channelId: hexToBytes(requireString(obj, "channelId")),
        timeoutAt: BigInt(requireString(obj, "timeoutAt")),
      };

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
};

// --- PaymentCheck bridge ---

export const paymentCheckToMessage = (
  check: PaymentCheck,
): PaymentCheckMessage => ({
  type: "payment_check",
  channelId: check.channelId,
  amount: check.amount,
  nonce: check.nonce,
  signature: check.signature,
});

export const messageToPaymentCheck = (
  msg: PaymentCheckMessage,
): PaymentCheck => ({
  channelId: msg.channelId,
  amount: msg.amount,
  nonce: msg.nonce,
  signature: msg.signature,
});

// --- Helpers ---

const requireString = (obj: Record<string, unknown>, key: string): string => {
  const val = obj[key];
  if (typeof val !== "string") {
    throw new Error(`Missing or invalid field: ${key}`);
  }
  return val;
};
