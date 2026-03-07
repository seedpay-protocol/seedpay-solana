import { assert } from "chai";
import nacl from "tweetnacl";
import {
  encodeMessage,
  decodeMessage,
  paymentCheckToMessage,
  messageToPaymentCheck,
  type SeedPayMessage,
} from "../src/messages";
import { signPaymentCheck } from "../src/payment-check";

describe("messages", () => {
  const channelId = new Uint8Array(32);
  channelId.fill(0xab);

  const publicKey = new Uint8Array(32);
  publicKey.fill(0x01);

  const signature = new Uint8Array(64);
  signature.fill(0xfe);

  const allMessages: SeedPayMessage[] = [
    { type: "ecdh_init", publicKey },
    {
      type: "channel_opened",
      channelId,
      txSignature: "5xK9...abc",
      deposited: 1_000_000n,
      timeout: 3600n,
    },
    { type: "channel_confirmed", channelId },
    { type: "channel_rejected", channelId, reason: "insufficient deposit" },
    { type: "payment_check", channelId, amount: 500_000n, nonce: 1n, signature },
    { type: "payment_check_required", amountOwed: 250_000n },
    { type: "payment_check_rejected", reason: "stale nonce" },
    { type: "channel_closed", channelId, txSignature: "7yM3...def" },
    { type: "channel_timeout_warning", channelId, timeoutAt: 1700000000n },
  ];

  describe("round-trip encode/decode", () => {
    for (const msg of allMessages) {
      it(`round-trips ${msg.type}`, () => {
        const encoded = encodeMessage(msg);
        const decoded = decodeMessage(encoded);

        assert.equal(decoded.type, msg.type);

        // Re-encode and compare for structural equality
        const reEncoded = encodeMessage(decoded);
        assert.deepEqual(reEncoded, encoded);
      });
    }
  });

  describe("encoding format", () => {
    it("encodes bigint as strings", () => {
      const encoded = encodeMessage({
        type: "channel_opened",
        channelId,
        txSignature: "tx1",
        deposited: 1_000_000n,
        timeout: 3600n,
      });

      assert.equal(encoded.deposited, "1000000");
      assert.equal(encoded.timeout, "3600");
    });

    it("encodes Uint8Array as hex", () => {
      const encoded = encodeMessage({ type: "ecdh_init", publicKey });
      assert.equal(encoded.publicKey, "01".repeat(32));
    });
  });

  describe("decode rejects invalid input", () => {
    it("rejects unknown type", () => {
      assert.throws(
        () => decodeMessage({ type: "unknown_type" }),
        "Unknown message type",
      );
    });

    it("rejects missing type", () => {
      assert.throws(
        () => decodeMessage({ foo: "bar" }),
        "Unknown message type",
      );
    });

    it("rejects missing fields", () => {
      assert.throws(
        () => decodeMessage({ type: "ecdh_init" }),
        "Missing or invalid field: publicKey",
      );
    });

    it("rejects non-string field values", () => {
      assert.throws(
        () => decodeMessage({ type: "ecdh_init", publicKey: 123 }),
        "Missing or invalid field: publicKey",
      );
    });
  });

  describe("PaymentCheck bridge", () => {
    it("converts PaymentCheck to message and back", () => {
      const keypair = nacl.sign.keyPair();
      const check = signPaymentCheck(channelId, 500_000n, 1n, keypair.secretKey);

      const msg = paymentCheckToMessage(check);
      assert.equal(msg.type, "payment_check");
      assert.equal(msg.amount, 500_000n);
      assert.equal(msg.nonce, 1n);

      const restored = messageToPaymentCheck(msg);
      assert.deepEqual(Array.from(restored.channelId), Array.from(check.channelId));
      assert.equal(restored.amount, check.amount);
      assert.equal(restored.nonce, check.nonce);
      assert.deepEqual(Array.from(restored.signature), Array.from(check.signature));
    });

    it("round-trips through encode/decode", () => {
      const keypair = nacl.sign.keyPair();
      const check = signPaymentCheck(channelId, 1_000_000n, 5n, keypair.secretKey);

      const msg = paymentCheckToMessage(check);
      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded);

      assert.equal(decoded.type, "payment_check");
      const restored = messageToPaymentCheck(decoded as typeof msg);
      assert.equal(restored.amount, check.amount);
      assert.equal(restored.nonce, check.nonce);
    });
  });
});
