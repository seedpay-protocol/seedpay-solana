import { assert } from "chai";
import nacl from "tweetnacl";
import {
  encodePaymentCheckMessage,
  signPaymentCheck,
  verifyPaymentCheck,
} from "../src/payment-check";

describe("paymentCheck", () => {
  // Generate a test keypair (simulates a Leecher's Solana wallet)
  const keypair = nacl.sign.keyPair();

  // Fake channel_id (in production this comes from ECDH)
  const channelId = new Uint8Array(32);
  channelId.fill(0xab);

  it("encodes message in canonical 48-byte format", () => {
    const message = encodePaymentCheckMessage(
      channelId,
      BigInt(1_000_000), // 1 USDC
      BigInt(1),
    );

    assert.equal(message.length, 48);

    // First 32 bytes = channel_id
    assert.deepEqual(Array.from(message.slice(0, 32)), Array.from(channelId));

    // Bytes 32..40 = amount as u64 LE (1_000_000 = 0x000F4240)
    const amountView = new DataView(message.buffer, 32, 8);
    assert.equal(amountView.getBigUint64(0, true), BigInt(1_000_000));

    // Bytes 40..48 = nonce as u64 LE
    const nonceView = new DataView(message.buffer, 40, 8);
    assert.equal(nonceView.getBigUint64(0, true), BigInt(1));
  });

  it("signs and verifies a payment check", () => {
    const check = signPaymentCheck(
      channelId,
      BigInt(500_000),
      BigInt(1),
      keypair.secretKey,
    );

    assert.equal(check.signature.length, 64);
    assert.equal(check.amount, BigInt(500_000));
    assert.equal(check.nonce, BigInt(1));

    const valid = verifyPaymentCheck(check, keypair.publicKey);
    assert.isTrue(valid);
  });

  it("rejects check with wrong public key", () => {
    const check = signPaymentCheck(
      channelId,
      BigInt(500_000),
      BigInt(1),
      keypair.secretKey,
    );

    const wrongKeypair = nacl.sign.keyPair();
    const valid = verifyPaymentCheck(check, wrongKeypair.publicKey);
    assert.isFalse(valid);
  });

  it("rejects tampered amount", () => {
    const check = signPaymentCheck(
      channelId,
      BigInt(500_000),
      BigInt(1),
      keypair.secretKey,
    );

    // Tamper with the amount
    const tampered = { ...check, amount: BigInt(999_999) };
    const valid = verifyPaymentCheck(tampered, keypair.publicKey);
    assert.isFalse(valid);
  });

  it("rejects tampered nonce", () => {
    const check = signPaymentCheck(
      channelId,
      BigInt(500_000),
      BigInt(1),
      keypair.secretKey,
    );

    const tampered = { ...check, nonce: BigInt(2) };
    const valid = verifyPaymentCheck(tampered, keypair.publicKey);
    assert.isFalse(valid);
  });

  it("rejects tampered channel_id", () => {
    const check = signPaymentCheck(
      channelId,
      BigInt(500_000),
      BigInt(1),
      keypair.secretKey,
    );

    const wrongChannelId = new Uint8Array(32);
    wrongChannelId.fill(0xcd);
    const tampered = { ...check, channelId: wrongChannelId };
    const valid = verifyPaymentCheck(tampered, keypair.publicKey);
    assert.isFalse(valid);
  });

  it("monotonically increasing checks are all valid", () => {
    // Simulates the Leecher signing checks as download progresses
    const checks = [
      signPaymentCheck(
        channelId,
        BigInt(100_000),
        BigInt(1),
        keypair.secretKey,
      ),
      signPaymentCheck(
        channelId,
        BigInt(300_000),
        BigInt(2),
        keypair.secretKey,
      ),
      signPaymentCheck(
        channelId,
        BigInt(500_000),
        BigInt(3),
        keypair.secretKey,
      ),
    ];

    for (const check of checks) {
      assert.isTrue(verifyPaymentCheck(check, keypair.publicKey));
    }

    // Amounts and nonces are increasing
    assert.isTrue(checks[1].amount > checks[0].amount);
    assert.isTrue(checks[2].amount > checks[1].amount);
    assert.isTrue(checks[1].nonce > checks[0].nonce);
    assert.isTrue(checks[2].nonce > checks[1].nonce);
  });
});
