import { generateEphemeralKeypair, deriveSessionKeys } from "./ecdh";
import { signPaymentCheck, verifyPaymentCheck } from "./payment-check";
import { PieceAccounting, computeCost } from "./accounting";
import type { PaymentCheck } from "./payment-check";
import type { EphemeralKeypair, SessionKeys } from "./ecdh";
import type { SeedPayMessage, PaymentCheckMessage } from "./messages";

// --- Session States ---

export type SessionState =
  | "idle"
  | "handshake"
  | "key_exchange"
  | "channel_pending"
  | "active"
  | "closing"
  | "closed"
  | "error";

// --- Session Actions (commands returned to caller) ---

export interface SendMessageAction {
  action: "send_message";
  message: SeedPayMessage;
}

export interface OpenChannelAction {
  action: "open_channel";
  channelId: Uint8Array;
  deposit: bigint;
  timeout: bigint;
}

export interface CloseChannelAction {
  action: "close_channel";
  channelId: Uint8Array;
  check: PaymentCheck;
}

export interface VerifyChannelAction {
  action: "verify_channel";
  channelId: Uint8Array;
  txSignature: string;
}

export interface ErrorAction {
  action: "error";
  message: string;
}

export type SessionAction =
  | SendMessageAction
  | OpenChannelAction
  | CloseChannelAction
  | VerifyChannelAction
  | ErrorAction;

// --- Session Config ---

export interface LeecherSessionConfig {
  deposit: bigint;
  timeout: bigint;
  pricePerMb: bigint;
  checkFrequencyMb: bigint;
  signingKey: Uint8Array;
}

export interface SeederSessionConfig {
  pricePerMb: bigint;
  checkFrequencyMb: bigint;
  minDeposit?: bigint;
}

// --- Leecher Session ---

export class LeecherSession {
  state: SessionState = "idle";

  private config: LeecherSessionConfig;
  private ephemeral: EphemeralKeypair | null = null;
  private sessionKeys: SessionKeys | null = null;
  private accounting: PieceAccounting;

  constructor(config: LeecherSessionConfig) {
    this.config = config;
    this.accounting = new PieceAccounting(config.pricePerMb, config.checkFrequencyMb);
  }

  start(): SessionAction[] {
    if (this.state !== "idle") {
      return [{ action: "error", message: `Cannot start in state: ${this.state}` }];
    }
    this.ephemeral = generateEphemeralKeypair();
    this.state = "handshake";
    return [
      {
        action: "send_message",
        message: { type: "ecdh_init", publicKey: this.ephemeral.publicKey },
      },
    ];
  }

  onEcdhInit(theirPublicKey: Uint8Array): SessionAction[] {
    if (this.state !== "handshake") {
      return [{ action: "error", message: `Unexpected ecdh_init in state: ${this.state}` }];
    }
    if (!this.ephemeral) {
      return [{ action: "error", message: "No ephemeral key" }];
    }
    this.sessionKeys = deriveSessionKeys(this.ephemeral.secretKey, theirPublicKey);
    this.state = "channel_pending";
    return [
      {
        action: "open_channel",
        channelId: this.sessionKeys.channelId,
        deposit: this.config.deposit,
        timeout: this.config.timeout,
      },
    ];
  }

  onChannelOpened(txSignature: string): SessionAction[] {
    if (this.state !== "channel_pending") {
      return [{ action: "error", message: `Unexpected channel_opened in state: ${this.state}` }];
    }
    return [
      {
        action: "send_message",
        message: {
          type: "channel_opened",
          channelId: this.sessionKeys!.channelId,
          txSignature,
          deposited: this.config.deposit,
          timeout: this.config.timeout,
        },
      },
    ];
  }

  onChannelConfirmed(): SessionAction[] {
    if (this.state !== "channel_pending") {
      return [{ action: "error", message: `Unexpected channel_confirmed in state: ${this.state}` }];
    }
    this.state = "active";
    return [];
  }

  onChannelRejected(reason: string): SessionAction[] {
    this.state = "error";
    return [{ action: "error", message: `Channel rejected: ${reason}` }];
  }

  onPieceReceived(bytes: bigint): SessionAction[] {
    if (this.state !== "active") {
      return [{ action: "error", message: `Unexpected piece in state: ${this.state}` }];
    }
    this.accounting.recordBytes(bytes);

    if (this.accounting.needsCheck()) {
      const amount = this.accounting.getNextCheckAmount();
      const nonce = this.accounting.getNextNonce();
      this.accounting.recordCheck(amount, nonce);

      return [
        {
          action: "send_message",
          message: {
            type: "payment_check",
            channelId: this.sessionKeys!.channelId,
            amount,
            nonce,
            signature: this.signCheck(amount, nonce),
          },
        },
      ];
    }
    return [];
  }

  onPaymentCheckRequired(): SessionAction[] {
    if (this.state !== "active") {
      return [{ action: "error", message: `Unexpected payment_check_required in state: ${this.state}` }];
    }
    const amount = this.accounting.getNextCheckAmount();
    const nonce = this.accounting.getNextNonce();
    this.accounting.recordCheck(amount, nonce);

    return [
      {
        action: "send_message",
        message: {
          type: "payment_check",
          channelId: this.sessionKeys!.channelId,
          amount,
          nonce,
          signature: this.signCheck(amount, nonce),
        },
      },
    ];
  }

  onChannelClosed(): SessionAction[] {
    this.state = "closed";
    return [];
  }

  getChannelId(): Uint8Array | null {
    return this.sessionKeys?.channelId ?? null;
  }

  getAccounting(): PieceAccounting {
    return this.accounting;
  }

  private signCheck(amount: bigint, nonce: bigint): Uint8Array {
    const check = signPaymentCheck(
      this.sessionKeys!.channelId,
      amount,
      nonce,
      this.config.signingKey,
    );
    return check.signature;
  }
}

// --- Seeder Session ---

export class SeederSession {
  state: SessionState = "idle";

  private config: SeederSessionConfig;
  private ephemeral: EphemeralKeypair | null = null;
  private sessionKeys: SessionKeys | null = null;
  private accounting: PieceAccounting;
  private highestCheck: PaymentCheck | null = null;
  private leecherPublicKey: Uint8Array | null = null;
  private channelDeposit: bigint = 0n;

  constructor(config: SeederSessionConfig) {
    this.config = config;
    this.accounting = new PieceAccounting(config.pricePerMb, config.checkFrequencyMb);
  }

  onEcdhInit(theirPublicKey: Uint8Array): SessionAction[] {
    if (this.state !== "idle") {
      return [{ action: "error", message: `Unexpected ecdh_init in state: ${this.state}` }];
    }
    this.ephemeral = generateEphemeralKeypair();
    this.sessionKeys = deriveSessionKeys(this.ephemeral.secretKey, theirPublicKey);
    this.state = "handshake";
    return [
      {
        action: "send_message",
        message: { type: "ecdh_init", publicKey: this.ephemeral.publicKey },
      },
    ];
  }

  onChannelOpened(txSignature: string): SessionAction[] {
    if (this.state !== "handshake") {
      return [{ action: "error", message: `Unexpected channel_opened in state: ${this.state}` }];
    }
    this.state = "channel_pending";

    return [
      {
        action: "verify_channel",
        channelId: this.sessionKeys!.channelId,
        txSignature,
      },
    ];
  }

  confirmChannel(
    deposited: bigint,
    leecherPublicKey: Uint8Array,
  ): SessionAction[] {
    if (this.state !== "channel_pending") {
      return [{ action: "error", message: `Cannot confirm in state: ${this.state}` }];
    }

    this.channelDeposit = deposited;
    this.leecherPublicKey = leecherPublicKey;

    if (this.config.minDeposit && deposited < this.config.minDeposit) {
      return this.rejectChannel("Deposit too low");
    }

    this.state = "active";
    return [
      {
        action: "send_message",
        message: { type: "channel_confirmed", channelId: this.sessionKeys!.channelId },
      },
    ];
  }

  rejectChannel(reason: string): SessionAction[] {
    this.state = "closed";
    return [
      {
        action: "send_message",
        message: {
          type: "channel_rejected",
          channelId: this.sessionKeys?.channelId ?? new Uint8Array(32),
          reason,
        },
      },
    ];
  }

  onPaymentCheck(msg: PaymentCheckMessage): SessionAction[] {
    if (this.state !== "active") {
      return [{ action: "error", message: `Unexpected payment_check in state: ${this.state}` }];
    }
    if (!this.leecherPublicKey) {
      return [{ action: "error", message: "No leecher public key" }];
    }

    const check: PaymentCheck = {
      channelId: msg.channelId,
      amount: msg.amount,
      nonce: msg.nonce,
      signature: msg.signature,
    };

    if (!verifyPaymentCheck(check, this.leecherPublicKey)) {
      return [
        {
          action: "send_message",
          message: { type: "payment_check_rejected", reason: "Invalid signature" },
        },
      ];
    }

    if (this.highestCheck && msg.nonce <= this.highestCheck.nonce) {
      return [
        {
          action: "send_message",
          message: { type: "payment_check_rejected", reason: "Stale nonce" },
        },
      ];
    }

    if (this.highestCheck && msg.amount < this.highestCheck.amount) {
      return [
        {
          action: "send_message",
          message: { type: "payment_check_rejected", reason: "Amount decreased" },
        },
      ];
    }

    if (msg.amount > this.channelDeposit) {
      return [
        {
          action: "send_message",
          message: { type: "payment_check_rejected", reason: "Amount exceeds deposit" },
        },
      ];
    }

    this.highestCheck = check;
    return [];
  }

  onPieceRequested(bytes: bigint): SessionAction[] {
    if (this.state !== "active") {
      return [{ action: "error", message: `Cannot serve piece in state: ${this.state}` }];
    }
    this.accounting.recordBytes(bytes);

    const owed = computeCost(this.accounting.getTotalBytes(), this.config.pricePerMb);
    const paid = this.highestCheck?.amount ?? 0n;

    if (owed > paid) {
      return [
        {
          action: "send_message",
          message: { type: "payment_check_required", amountOwed: owed },
        },
      ];
    }
    return [];
  }

  initiateClose(): SessionAction[] {
    if (this.state !== "active") {
      return [{ action: "error", message: `Cannot close in state: ${this.state}` }];
    }
    this.state = "closing";

    if (this.highestCheck) {
      return [
        {
          action: "close_channel",
          channelId: this.sessionKeys!.channelId,
          check: this.highestCheck,
        },
      ];
    }
    // No checks received — nothing to claim
    this.state = "closed";
    return [];
  }

  onChannelClosed(): SessionAction[] {
    this.state = "closed";
    return [];
  }

  onDisconnect(): SessionAction[] {
    if (this.state === "active" && this.highestCheck) {
      this.state = "closing";
      return [
        {
          action: "close_channel",
          channelId: this.sessionKeys!.channelId,
          check: this.highestCheck,
        },
      ];
    }
    this.state = "closed";
    return [];
  }

  getChannelId(): Uint8Array | null {
    return this.sessionKeys?.channelId ?? null;
  }

  getHighestCheck(): PaymentCheck | null {
    return this.highestCheck;
  }

  getAccounting(): PieceAccounting {
    return this.accounting;
  }
}
