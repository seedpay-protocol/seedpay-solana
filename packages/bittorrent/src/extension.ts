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

export const parseHandshakeMetadata = (
  dict: Record<string, unknown>,
): HandshakeMetadata | null => {
  const wallet = dict.wallet;
  const pricePerMb = dict.price_per_mb;
  const minPrepayment = dict.min_prepayment;
  const chain = dict.chain;

  if (
    typeof wallet !== "string" ||
    typeof pricePerMb !== "string" ||
    typeof minPrepayment !== "string" ||
    typeof chain !== "string"
  ) {
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
