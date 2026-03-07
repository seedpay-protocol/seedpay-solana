import { assert } from "chai";
import {
  computeCost,
  shouldSendCheck,
  isPaymentSufficient,
  PieceAccounting,
} from "../src/accounting";

const MB = 1_048_576n;

describe("accounting", () => {
  describe("computeCost", () => {
    it("returns 0 for 0 bytes", () => {
      assert.equal(computeCost(0n, 100n), 0n);
    });

    it("computes cost for exactly 1 MB", () => {
      assert.equal(computeCost(MB, 100n), 100n);
    });

    it("rounds up for partial MB", () => {
      // 1 byte at 100 per MB should cost 1 (ceil division)
      assert.equal(computeCost(1n, 100n), 1n);
    });

    it("computes cost for multiple MBs", () => {
      assert.equal(computeCost(5n * MB, 200n), 1000n);
    });

    it("handles large amounts", () => {
      const cost = computeCost(1000n * MB, 1_000_000n);
      assert.equal(cost, 1_000_000_000n);
    });
  });

  describe("shouldSendCheck", () => {
    const pricePerMb = 100n;
    const checkFrequencyMb = 1n;

    it("returns true when cost exceeds last check + frequency threshold", () => {
      // Downloaded 2 MB, last check was for 0
      const result = shouldSendCheck(2n * MB, 0n, pricePerMb, checkFrequencyMb);
      assert.isTrue(result);
    });

    it("returns false when under threshold", () => {
      // Downloaded 0.5 MB, last check was for 0, frequency is 1 MB
      const result = shouldSendCheck(MB / 2n, 0n, pricePerMb, checkFrequencyMb);
      assert.isFalse(result);
    });

    it("returns true at exactly the threshold", () => {
      const result = shouldSendCheck(MB, 0n, pricePerMb, checkFrequencyMb);
      assert.isTrue(result);
    });

    it("accounts for last check amount", () => {
      // Downloaded 2 MB (cost 200), last check was 100, frequency threshold is 100
      const result = shouldSendCheck(2n * MB, 100n, pricePerMb, checkFrequencyMb);
      assert.isTrue(result);
    });
  });

  describe("isPaymentSufficient", () => {
    it("returns true when check covers cost", () => {
      assert.isTrue(isPaymentSufficient(100n, 100n));
    });

    it("returns true when check exceeds cost", () => {
      assert.isTrue(isPaymentSufficient(100n, 200n));
    });

    it("returns false when check is below cost", () => {
      assert.isFalse(isPaymentSufficient(200n, 100n));
    });
  });

  describe("PieceAccounting", () => {
    const pricePerMb = 100n;
    const checkFrequencyMb = 1n;

    it("tracks bytes and triggers check at threshold", () => {
      const acc = new PieceAccounting(pricePerMb, checkFrequencyMb);

      acc.recordBytes(MB / 2n);
      assert.isFalse(acc.needsCheck());

      acc.recordBytes(MB / 2n);
      assert.isTrue(acc.needsCheck());
    });

    it("returns correct next check amount", () => {
      const acc = new PieceAccounting(pricePerMb, checkFrequencyMb);
      acc.recordBytes(3n * MB);
      assert.equal(acc.getNextCheckAmount(), 300n);
    });

    it("returns correct next nonce", () => {
      const acc = new PieceAccounting(pricePerMb, checkFrequencyMb);
      assert.equal(acc.getNextNonce(), 1n);

      acc.recordBytes(MB);
      acc.recordCheck(100n, 1n);
      assert.equal(acc.getNextNonce(), 2n);
    });

    it("rejects non-monotonic check amounts", () => {
      const acc = new PieceAccounting(pricePerMb, checkFrequencyMb);
      acc.recordBytes(2n * MB);
      acc.recordCheck(200n, 1n);

      assert.throws(
        () => acc.recordCheck(100n, 2n),
        "Check amount must be monotonically increasing",
      );
    });

    it("rejects non-increasing nonce", () => {
      const acc = new PieceAccounting(pricePerMb, checkFrequencyMb);
      acc.recordBytes(2n * MB);
      acc.recordCheck(100n, 1n);

      assert.throws(
        () => acc.recordCheck(200n, 1n),
        "Nonce must be strictly increasing",
      );
    });

    it("resets check threshold after recording a check", () => {
      const acc = new PieceAccounting(pricePerMb, checkFrequencyMb);

      acc.recordBytes(MB);
      assert.isTrue(acc.needsCheck());

      acc.recordCheck(100n, 1n);
      assert.isFalse(acc.needsCheck());

      acc.recordBytes(MB);
      assert.isTrue(acc.needsCheck());
    });

    it("exposes getters", () => {
      const acc = new PieceAccounting(pricePerMb, checkFrequencyMb);
      acc.recordBytes(MB);
      acc.recordCheck(100n, 1n);

      assert.equal(acc.getTotalBytes(), MB);
      assert.equal(acc.getLastCheckAmount(), 100n);
      assert.equal(acc.getLastNonce(), 1n);
    });
  });
});
