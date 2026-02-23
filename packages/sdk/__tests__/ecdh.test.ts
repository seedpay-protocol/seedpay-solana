import { assert } from "chai";
import {
  generateEphemeralKeypair,
  deriveSessionKeys,
  computeChannelId,
} from "../src/ecdh";

describe("ecdh", () => {
  it("both peers derive the same session keys", () => {
    // Simulate two peers generating ephemeral keypairs
    const leecher = generateEphemeralKeypair();
    const seeder = generateEphemeralKeypair();

    // Each peer derives session keys using their secret + other's public
    const leecherSession = deriveSessionKeys(
      leecher.secretKey,
      seeder.publicKey,
    );
    const seederSession = deriveSessionKeys(
      seeder.secretKey,
      leecher.publicKey,
    );

    // Both must arrive at identical values
    assert.deepEqual(
      Array.from(leecherSession.sharedSecret),
      Array.from(seederSession.sharedSecret),
      "shared secrets must match",
    );

    assert.deepEqual(
      Array.from(leecherSession.sessionUUID),
      Array.from(seederSession.sessionUUID),
      "session UUIDs must match",
    );

    assert.deepEqual(
      Array.from(leecherSession.channelId),
      Array.from(seederSession.channelId),
      "channel IDs must match",
    );
  });

  it("different sessions produce different channel IDs", () => {
    const leecher = generateEphemeralKeypair();

    // Two different seeders = two different sessions
    const seeder1 = generateEphemeralKeypair();
    const seeder2 = generateEphemeralKeypair();

    const session1 = deriveSessionKeys(leecher.secretKey, seeder1.publicKey);
    const session2 = deriveSessionKeys(leecher.secretKey, seeder2.publicKey);

    assert.notDeepEqual(
      Array.from(session1.channelId),
      Array.from(session2.channelId),
      "different peers must produce different channel IDs",
    );
  });

  it("same peers with fresh keypairs produce different channel IDs", () => {
    // Even the same two people reconnecting get a new channel_id
    // because they generate NEW ephemeral keypairs each time
    const leecher1 = generateEphemeralKeypair();
    const seeder1 = generateEphemeralKeypair();
    const session1 = deriveSessionKeys(leecher1.secretKey, seeder1.publicKey);

    const leecher2 = generateEphemeralKeypair();
    const seeder2 = generateEphemeralKeypair();
    const session2 = deriveSessionKeys(leecher2.secretKey, seeder2.publicKey);

    assert.notDeepEqual(
      Array.from(session1.channelId),
      Array.from(session2.channelId),
      "fresh keypairs must produce different channel IDs (unlinkability)",
    );
  });

  it("channel ID length is 32 bytes", () => {
    const leecher = generateEphemeralKeypair();
    const seeder = generateEphemeralKeypair();
    const session = deriveSessionKeys(leecher.secretKey, seeder.publicKey);

    assert.equal(session.channelId.length, 32);
  });

  it("computeChannelId matches deriveSessionKeys output", () => {
    const leecher = generateEphemeralKeypair();
    const seeder = generateEphemeralKeypair();
    const session = deriveSessionKeys(leecher.secretKey, seeder.publicKey);

    const channelId = computeChannelId(session.sessionUUID);
    assert.deepEqual(Array.from(channelId), Array.from(session.channelId));
  });
});
