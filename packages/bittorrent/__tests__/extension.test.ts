import { assert } from "chai";
import {
  encodeBep10Message,
  decodeBep10Message,
  createHandshakeMetadata,
  parseHandshakeMetadata,
  ExtensionNegotiator,
  EXTENSION_NAME,
} from "../src/extension";
import type { SeedPayMessage } from "@seedpay/sdk";

describe("extension", () => {
  describe("BEP 10 message encoding", () => {
    const messages: SeedPayMessage[] = [
      { type: "ecdh_init", publicKey: new Uint8Array(32).fill(0x01) },
      {
        type: "channel_opened",
        channelId: new Uint8Array(32).fill(0xab),
        txSignature: "5xK9abc",
        deposited: 1_000_000n,
        timeout: 3600n,
      },
      { type: "channel_confirmed", channelId: new Uint8Array(32).fill(0xab) },
      { type: "payment_check_required", amountOwed: 250_000n },
      { type: "payment_check_rejected", reason: "stale nonce" },
    ];

    for (const msg of messages) {
      it(`round-trips ${msg.type} through bencode`, () => {
        const encoded = encodeBep10Message(msg);
        assert.instanceOf(encoded, Uint8Array);

        const decoded = decodeBep10Message(encoded);
        assert.equal(decoded.type, msg.type);

        // Re-encode to verify structural equality
        const reEncoded = encodeBep10Message(decoded);
        assert.deepEqual(Array.from(reEncoded), Array.from(encoded));
      });
    }
  });

  describe("handshake metadata", () => {
    it("creates and parses metadata", () => {
      const meta = {
        wallet: "7xK9...pubkey",
        pricePerMb: 100n,
        minPrepayment: 1000n,
        chain: "solana-devnet",
      };

      const dict = createHandshakeMetadata(meta);
      assert.equal(dict.wallet, "7xK9...pubkey");
      assert.equal(dict.price_per_mb, "100");
      assert.equal(dict.min_prepayment, "1000");
      assert.equal(dict.chain, "solana-devnet");

      const parsed = parseHandshakeMetadata(dict);
      assert.isNotNull(parsed);
      assert.equal(parsed!.wallet, meta.wallet);
      assert.equal(parsed!.pricePerMb, meta.pricePerMb);
      assert.equal(parsed!.minPrepayment, meta.minPrepayment);
      assert.equal(parsed!.chain, meta.chain);
    });

    it("returns null for missing fields", () => {
      assert.isNull(parseHandshakeMetadata({ wallet: "x" }));
    });

    it("returns null for invalid bigint", () => {
      assert.isNull(
        parseHandshakeMetadata({
          wallet: "x",
          price_per_mb: "not_a_number",
          min_prepayment: "100",
          chain: "solana",
        }),
      );
    });
  });

  describe("ExtensionNegotiator", () => {
    it("generates local handshake entry", () => {
      const neg = new ExtensionNegotiator(5);
      const entry = neg.getLocalHandshakeEntry();
      assert.deepEqual(entry, { [EXTENSION_NAME]: 5 });
    });

    it("processes remote handshake successfully", () => {
      const neg = new ExtensionNegotiator();
      const result = neg.processRemoteHandshake({ seedpay: 3 });
      assert.isTrue(result);
      assert.equal(neg.getRemoteId(), 3);
      assert.isTrue(neg.isNegotiated());
    });

    it("fails when remote has no seedpay extension", () => {
      const neg = new ExtensionNegotiator();
      const result = neg.processRemoteHandshake({ ut_metadata: 1 });
      assert.isFalse(result);
      assert.isNull(neg.getRemoteId());
      assert.isFalse(neg.isNegotiated());
    });

    it("fails when remote id is 0", () => {
      const neg = new ExtensionNegotiator();
      const result = neg.processRemoteHandshake({ seedpay: 0 });
      assert.isFalse(result);
    });
  });
});
