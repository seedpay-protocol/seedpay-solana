import { assert } from "chai";
import nacl from "tweetnacl";
import { LeecherSession, SeederSession } from "../src/session";
import type { SessionAction, SendMessageAction } from "../src/session";
import type { PaymentCheckMessage } from "../src/messages";
import { verifyPaymentCheck } from "../src/payment-check";

const MB = 1_048_576n;

const findAction = <T extends SessionAction>(
  actions: SessionAction[],
  type: T["action"],
): T | undefined => actions.find((a) => a.action === type) as T | undefined;

const findSendMessage = (
  actions: SessionAction[],
  msgType: string,
): SendMessageAction | undefined =>
  actions.find(
    (a) => a.action === "send_message" && a.message.type === msgType,
  ) as SendMessageAction | undefined;

describe("session", () => {
  const keypair = nacl.sign.keyPair();
  const pricePerMb = 100n;
  const checkFrequencyMb = 1n;

  const makeLeecherConfig = () => ({
    deposit: 10_000n,
    timeout: 3600n,
    pricePerMb,
    checkFrequencyMb,
    signingKey: keypair.secretKey,
  });

  const makeSeederConfig = () => ({
    pricePerMb,
    checkFrequencyMb,
    minDeposit: 1_000n,
  });

  describe("LeecherSession", () => {
    it("starts with idle state", () => {
      const session = new LeecherSession(makeLeecherConfig());
      assert.equal(session.state, "idle");
    });

    it("start() transitions to handshake and sends ecdh_init", () => {
      const session = new LeecherSession(makeLeecherConfig());
      const actions = session.start();

      assert.equal(session.state, "handshake");
      const send = findSendMessage(actions, "ecdh_init");
      assert.isDefined(send);
      assert.equal(send!.message.type, "ecdh_init");
    });

    it("rejects start() in wrong state", () => {
      const session = new LeecherSession(makeLeecherConfig());
      session.start();
      const actions = session.start();
      assert.isDefined(findAction(actions, "error"));
    });

    it("onEcdhInit transitions to channel_pending and returns open_channel", () => {
      const session = new LeecherSession(makeLeecherConfig());
      session.start();

      const seederKey = new Uint8Array(32).fill(0x02);
      const actions = session.onEcdhInit(seederKey);

      assert.equal(session.state, "channel_pending");
      const openAction = findAction(actions, "open_channel");
      assert.isDefined(openAction);
    });

    it("onChannelConfirmed transitions to active", () => {
      const session = new LeecherSession(makeLeecherConfig());
      session.start();
      session.onEcdhInit(new Uint8Array(32).fill(0x02));
      session.onChannelOpened("txSig123");
      session.onChannelConfirmed();

      assert.equal(session.state, "active");
    });

    it("onChannelRejected transitions to error", () => {
      const session = new LeecherSession(makeLeecherConfig());
      session.start();
      session.onEcdhInit(new Uint8Array(32).fill(0x02));

      const actions = session.onChannelRejected("too low");
      assert.equal(session.state, "error");
      assert.isDefined(findAction(actions, "error"));
    });

    it("onChannelClosed transitions to closed", () => {
      const session = new LeecherSession(makeLeecherConfig());
      session.start();
      session.onEcdhInit(new Uint8Array(32).fill(0x02));
      session.onChannelOpened("txSig123");
      session.onChannelConfirmed();
      session.onChannelClosed();

      assert.equal(session.state, "closed");
    });
  });

  describe("SeederSession", () => {
    it("starts with idle state", () => {
      const session = new SeederSession(makeSeederConfig());
      assert.equal(session.state, "idle");
    });

    it("onEcdhInit transitions to handshake and sends ecdh_init", () => {
      const session = new SeederSession(makeSeederConfig());
      const leecherKey = new Uint8Array(32).fill(0x01);
      const actions = session.onEcdhInit(leecherKey);

      assert.equal(session.state, "handshake");
      const send = findSendMessage(actions, "ecdh_init");
      assert.isDefined(send);
    });

    it("rejects onEcdhInit in wrong state", () => {
      const session = new SeederSession(makeSeederConfig());
      session.onEcdhInit(new Uint8Array(32).fill(0x01));
      const actions = session.onEcdhInit(new Uint8Array(32).fill(0x02));
      assert.isDefined(findAction(actions, "error"));
    });

    it("onChannelOpened transitions to channel_pending and returns verify_channel", () => {
      const session = new SeederSession(makeSeederConfig());
      session.onEcdhInit(new Uint8Array(32).fill(0x01));

      const actions = session.onChannelOpened("txSig123", 10_000n, keypair.publicKey);
      assert.equal(session.state, "channel_pending");
      assert.isDefined(findAction(actions, "verify_channel"));
    });

    it("rejects channel with insufficient deposit", () => {
      const session = new SeederSession(makeSeederConfig());
      session.onEcdhInit(new Uint8Array(32).fill(0x01));

      const actions = session.onChannelOpened("txSig123", 500n, keypair.publicKey);
      assert.equal(session.state, "closed");
      const send = findSendMessage(actions, "channel_rejected");
      assert.isDefined(send);
    });

    it("confirmChannel transitions to active", () => {
      const session = new SeederSession(makeSeederConfig());
      session.onEcdhInit(new Uint8Array(32).fill(0x01));
      session.onChannelOpened("txSig123", 10_000n, keypair.publicKey);

      const actions = session.confirmChannel();
      assert.equal(session.state, "active");
      assert.isDefined(findSendMessage(actions, "channel_confirmed"));
    });

    it("rejectChannel transitions to closed", () => {
      const session = new SeederSession(makeSeederConfig());
      session.onEcdhInit(new Uint8Array(32).fill(0x01));
      session.onChannelOpened("txSig123", 10_000n, keypair.publicKey);

      const actions = session.rejectChannel("policy");
      assert.equal(session.state, "closed");
      assert.isDefined(findSendMessage(actions, "channel_rejected"));
    });

    it("onDisconnect with no checks just closes", () => {
      const session = new SeederSession(makeSeederConfig());
      session.onEcdhInit(new Uint8Array(32).fill(0x01));
      session.onChannelOpened("txSig123", 10_000n, keypair.publicKey);
      session.confirmChannel();

      const actions = session.onDisconnect();
      assert.equal(session.state, "closed");
      assert.equal(actions.length, 0);
    });

    it("initiateClose with no checks closes without action", () => {
      const session = new SeederSession(makeSeederConfig());
      session.onEcdhInit(new Uint8Array(32).fill(0x01));
      session.onChannelOpened("txSig123", 10_000n, keypair.publicKey);
      session.confirmChannel();

      const actions = session.initiateClose();
      assert.equal(session.state, "closed");
      assert.equal(actions.length, 0);
    });
  });

  describe("full lifecycle (leecher + seeder)", () => {
    it("happy path: handshake → active → payment → close", () => {
      const leecher = new LeecherSession(makeLeecherConfig());
      const seeder = new SeederSession(makeSeederConfig());

      // 1. Leecher starts handshake
      const leecherStart = leecher.start();
      const ecdhMsg = findSendMessage(leecherStart, "ecdh_init")!;
      const leecherPubKey = (ecdhMsg.message as any).publicKey as Uint8Array;

      // 2. Seeder receives ecdh_init, responds
      const seederEcdh = seeder.onEcdhInit(leecherPubKey);
      const seederPubKey = (findSendMessage(seederEcdh, "ecdh_init")!.message as any)
        .publicKey as Uint8Array;

      // 3. Leecher receives seeder's ecdh_init → derives keys, opens channel
      const leecherKeyExchange = leecher.onEcdhInit(seederPubKey);
      assert.equal(leecher.state, "channel_pending");
      const openAction = findAction(leecherKeyExchange, "open_channel")!;
      assert.isDefined(openAction);

      // 4. Leecher notifies seeder of channel opened
      const leecherOpened = leecher.onChannelOpened("txSigABC");
      const openedMsg = findSendMessage(leecherOpened, "channel_opened")!;

      // 5. Seeder receives channel_opened, verifies
      const seederVerify = seeder.onChannelOpened(
        "txSigABC",
        10_000n,
        keypair.publicKey,
      );
      assert.isDefined(findAction(seederVerify, "verify_channel"));

      // 6. Seeder confirms channel
      const seederConfirm = seeder.confirmChannel();
      assert.isDefined(findSendMessage(seederConfirm, "channel_confirmed"));

      // 7. Leecher receives confirmation
      leecher.onChannelConfirmed();
      assert.equal(leecher.state, "active");
      assert.equal(seeder.state, "active");

      // 8. Download 1 MB — triggers payment check
      const pieceActions = leecher.onPieceReceived(MB);
      const checkMsg = findSendMessage(pieceActions, "payment_check");
      assert.isDefined(checkMsg);

      // 9. Seeder receives payment check
      const checkResult = seeder.onPaymentCheck(
        checkMsg!.message as PaymentCheckMessage,
      );
      assert.equal(checkResult.length, 0); // accepted

      // 10. Seeder has highest check
      assert.isNotNull(seeder.getHighestCheck());

      // 11. Seeder initiates close
      const closeActions = seeder.initiateClose();
      assert.equal(seeder.state, "closing");
      const closeAction = findAction(closeActions, "close_channel");
      assert.isDefined(closeAction);
    });

    it("seeder requests payment before serving", () => {
      const leecher = new LeecherSession(makeLeecherConfig());
      const seeder = new SeederSession(makeSeederConfig());

      // Quick setup to active state
      const leecherStart = leecher.start();
      const leecherPubKey = (findSendMessage(leecherStart, "ecdh_init")!.message as any).publicKey;
      const seederEcdh = seeder.onEcdhInit(leecherPubKey);
      const seederPubKey = (findSendMessage(seederEcdh, "ecdh_init")!.message as any).publicKey;
      leecher.onEcdhInit(seederPubKey);
      leecher.onChannelOpened("tx1");
      seeder.onChannelOpened("tx1", 10_000n, keypair.publicKey);
      seeder.confirmChannel();
      leecher.onChannelConfirmed();

      // Seeder gets piece request without payment
      const requestActions = seeder.onPieceRequested(MB);
      const payReq = findSendMessage(requestActions, "payment_check_required");
      assert.isDefined(payReq);

      // Leecher responds to payment_check_required
      const payActions = leecher.onPaymentCheckRequired();
      const payCheck = findSendMessage(payActions, "payment_check");
      assert.isDefined(payCheck);
    });

    it("seeder rejects invalid payment check signature", () => {
      const seeder = new SeederSession(makeSeederConfig());
      const wrongKeypair = nacl.sign.keyPair();

      // Setup seeder to active
      seeder.onEcdhInit(new Uint8Array(32).fill(0x01));
      seeder.onChannelOpened("tx1", 10_000n, keypair.publicKey);
      seeder.confirmChannel();

      const channelId = seeder.getChannelId()!;
      const fakeCheckMsg: PaymentCheckMessage = {
        type: "payment_check",
        channelId,
        amount: 100n,
        nonce: 1n,
        signature: new Uint8Array(64).fill(0xff),
      };

      const actions = seeder.onPaymentCheck(fakeCheckMsg);
      const rejected = findSendMessage(actions, "payment_check_rejected");
      assert.isDefined(rejected);
    });

    it("seeder rejects stale nonce", () => {
      const seeder = new SeederSession(makeSeederConfig());
      const leecher = new LeecherSession(makeLeecherConfig());

      // Setup to active
      const leecherStart = leecher.start();
      const leecherPubKey = (findSendMessage(leecherStart, "ecdh_init")!.message as any).publicKey;
      const seederEcdh = seeder.onEcdhInit(leecherPubKey);
      const seederPubKey = (findSendMessage(seederEcdh, "ecdh_init")!.message as any).publicKey;
      leecher.onEcdhInit(seederPubKey);
      leecher.onChannelOpened("tx1");
      seeder.onChannelOpened("tx1", 10_000n, keypair.publicKey);
      seeder.confirmChannel();
      leecher.onChannelConfirmed();

      // Send first check
      const first = leecher.onPieceReceived(MB);
      const firstCheck = findSendMessage(first, "payment_check")!;
      seeder.onPaymentCheck(firstCheck.message as PaymentCheckMessage);

      // Replay same check (stale nonce)
      const replayActions = seeder.onPaymentCheck(firstCheck.message as PaymentCheckMessage);
      const rejected = findSendMessage(replayActions, "payment_check_rejected");
      assert.isDefined(rejected);
    });

    it("seeder claims on disconnect with valid check", () => {
      const seeder = new SeederSession(makeSeederConfig());
      const leecher = new LeecherSession(makeLeecherConfig());

      // Setup to active
      const leecherStart = leecher.start();
      const leecherPubKey = (findSendMessage(leecherStart, "ecdh_init")!.message as any).publicKey;
      const seederEcdh = seeder.onEcdhInit(leecherPubKey);
      const seederPubKey = (findSendMessage(seederEcdh, "ecdh_init")!.message as any).publicKey;
      leecher.onEcdhInit(seederPubKey);
      leecher.onChannelOpened("tx1");
      seeder.onChannelOpened("tx1", 10_000n, keypair.publicKey);
      seeder.confirmChannel();
      leecher.onChannelConfirmed();

      // Send a check
      const pieceActions = leecher.onPieceReceived(MB);
      const checkMsg = findSendMessage(pieceActions, "payment_check")!;
      seeder.onPaymentCheck(checkMsg.message as PaymentCheckMessage);

      // Disconnect — seeder should claim
      const disconnectActions = seeder.onDisconnect();
      assert.equal(seeder.state, "closing");
      assert.isDefined(findAction(disconnectActions, "close_channel"));
    });

    it("seeder rejects amount exceeding deposit", () => {
      const seeder = new SeederSession({ pricePerMb, checkFrequencyMb });
      seeder.onEcdhInit(new Uint8Array(32).fill(0x01));
      seeder.onChannelOpened("tx1", 100n, keypair.publicKey); // small deposit, no minDeposit
      seeder.confirmChannel();

      const channelId = seeder.getChannelId()!;

      // Create a valid signature for an amount > deposit
      const { signPaymentCheck } = require("../src/payment-check");
      const check = signPaymentCheck(channelId, 200n, 1n, keypair.secretKey);

      const msg: PaymentCheckMessage = {
        type: "payment_check",
        channelId,
        amount: 200n,
        nonce: 1n,
        signature: check.signature,
      };

      const actions = seeder.onPaymentCheck(msg);
      const rejected = findSendMessage(actions, "payment_check_rejected");
      assert.isDefined(rejected);
    });
  });
});
