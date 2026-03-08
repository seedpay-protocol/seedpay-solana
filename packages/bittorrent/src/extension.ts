import { encode, decode } from "./bencode";
import {
  encodeMessage,
  decodeMessage,
  type SeedPayMessage,
} from "@seedpay/sdk";

// --- BEP 10 Message Encoding ---

export const EXTENSION_NAME = "seedpay";

export const encodeBep10Message = (msg: SeedPayMessage): Uint8Array => {
  const plain = encodeMessage(msg);
  return encode(plain);
};

export const decodeBep10Message = (buf: Uint8Array): SeedPayMessage => {
  const decoded = decode(buf, "utf8") as Record<string, unknown>;
  return decodeMessage(decoded);
};

// --- Handshake Metadata ---

export interface HandshakeMetadata {
  wallet: string;
  pricePerMb: bigint;
  minPrepayment: bigint;
  chain: string;
}

export const createHandshakeMetadata = (
  meta: HandshakeMetadata,
): Record<string, string> => ({
  wallet: meta.wallet,
  price_per_mb: meta.pricePerMb.toString(),
  min_prepayment: meta.minPrepayment.toString(),
  chain: meta.chain,
});

// Bencode may deliver strings as Buffers — coerce to string
const toStr = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf-8");
  if (v instanceof Uint8Array) return Buffer.from(v).toString("utf-8");
  return null;
};

export const parseHandshakeMetadata = (
  dict: Record<string, unknown>,
): HandshakeMetadata | null => {
  const wallet = toStr(dict.wallet);
  const pricePerMb = toStr(dict.price_per_mb);
  const minPrepayment = toStr(dict.min_prepayment);
  const chain = toStr(dict.chain);

  if (!wallet || !pricePerMb || !minPrepayment || !chain) {
    return null;
  }

  try {
    return {
      wallet,
      pricePerMb: BigInt(pricePerMb),
      minPrepayment: BigInt(minPrepayment),
      chain,
    };
  } catch {
    return null;
  }
};

// --- Extension Negotiator ---

export class ExtensionNegotiator {
  private localId: number;
  private remoteId: number | null = null;

  constructor(localId: number = 1) {
    this.localId = localId;
  }

  getLocalId(): number {
    return this.localId;
  }

  getRemoteId(): number | null {
    return this.remoteId;
  }

  getLocalHandshakeEntry(): Record<string, number> {
    return { [EXTENSION_NAME]: this.localId };
  }

  processRemoteHandshake(
    remoteExtensions: Record<string, number>,
  ): boolean {
    const id = remoteExtensions[EXTENSION_NAME];
    if (typeof id === "number" && id > 0) {
      this.remoteId = id;
      return true;
    }
    return false;
  }

  isNegotiated(): boolean {
    return this.remoteId !== null;
  }
}
