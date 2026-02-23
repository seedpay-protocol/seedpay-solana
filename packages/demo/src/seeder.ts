import { Keypair, PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { Seedpay } from "../../../target/types/seedpay";
import {
  generateEphemeralKeypair,
  deriveSessionKeys,
  verifyPaymentCheck,
  ChannelClient,
} from "../../sdk/src";
import type {
  EphemeralKeypair,
  SessionKeys,
  PaymentCheck,
  ChannelInfo,
  TxResult,
} from "../../sdk/src";
import type { DemoConfig } from "./config";

export interface SeederState {
  ephemeralKeys: EphemeralKeypair;
  sessionKeys: SessionKeys | null;
  channelClient: ChannelClient;
  wallet: Keypair;
  tokenAccount: PublicKey;
  highestCheck: PaymentCheck | null;
  lastNonce: bigint;
  lastAmount: bigint;
  bytesServed: number;
  channelInfo: ChannelInfo | null;
}

export class Seeder {
  public state: SeederState;
  private config: DemoConfig;
  private leecherPubkey: PublicKey | null = null;

  constructor(
    program: Program<Seedpay>,
    wallet: Keypair,
    tokenAccount: PublicKey,
    config: DemoConfig,
  ) {
    this.config = config;
    this.state = {
      ephemeralKeys: generateEphemeralKeypair(),
      sessionKeys: null,
      channelClient: new ChannelClient(program),
      wallet,
      tokenAccount,
      highestCheck: null,
      lastNonce: 0n,
      lastAmount: 0n,
      bytesServed: 0,
      channelInfo: null,
    };
  }

  getEphemeralPublicKey(): Uint8Array {
    return this.state.ephemeralKeys.publicKey;
  }

  completeKeyExchange(leecherEphemeralPk: Uint8Array): SessionKeys {
    const sessionKeys = deriveSessionKeys(
      this.state.ephemeralKeys.secretKey,
      leecherEphemeralPk,
    );
    this.state.sessionKeys = sessionKeys;
    return sessionKeys;
  }

  async verifyChannel(leecherWallet: PublicKey): Promise<ChannelInfo> {
    if (!this.state.sessionKeys) {
      throw new Error("Must complete key exchange before verifying channel");
    }

    this.leecherPubkey = leecherWallet;

    const info = await this.state.channelClient.fetchChannel(
      leecherWallet,
      this.state.wallet.publicKey,
      this.state.sessionKeys.channelId,
    );

    if (!info) {
      throw new Error("Channel not found on-chain");
    }

    // Verify channel is open
    if (info.status !== "open") {
      throw new Error(`Channel status is '${info.status}', expected 'open'`);
    }

    // Verify seeder matches
    if (!info.seeder.equals(this.state.wallet.publicKey)) {
      throw new Error("Channel seeder does not match this wallet");
    }

    // Verify deposit meets minimum
    if (info.deposited < this.config.depositAmount) {
      throw new Error(
        `Deposit ${info.deposited} below minimum ${this.config.depositAmount}`,
      );
    }

    this.state.channelInfo = info;
    return info;
  }

  validateCheck(check: PaymentCheck, leecherPubkey: PublicKey): boolean {
    if (!this.state.sessionKeys) {
      throw new Error("Must complete key exchange before validating checks");
    }

    const valid = verifyPaymentCheck(check, leecherPubkey.toBytes());

    if (!valid) {
      throw new Error(`Payment check #${check.nonce} has invalid signature`);
    }

    if (check.nonce <= this.state.lastNonce) {
      throw new Error(
        `Stale nonce: got ${check.nonce}, expected > ${this.state.lastNonce}`,
      );
    }

    if (check.amount < this.state.lastAmount) {
      throw new Error(
        `Amount decreased: got ${check.amount}, last was ${this.state.lastAmount}`,
      );
    }

    if (
      this.state.channelInfo &&
      check.amount > this.state.channelInfo.deposited
    ) {
      throw new Error(
        `Amount ${check.amount} exceeds deposit ${this.state.channelInfo.deposited}`,
      );
    }

    this.state.lastNonce = check.nonce;
    this.state.lastAmount = check.amount;
    this.state.highestCheck = check;

    return true;
  }

  recordBytesServed(bytes: number): void {
    this.state.bytesServed += bytes;
  }

  async closeChannel(leecherTokenAccount: PublicKey): Promise<TxResult> {
    if (!this.state.sessionKeys) {
      throw new Error("Must complete key exchange before closing channel");
    }
    if (!this.state.highestCheck) {
      throw new Error(
        "No valid payment checks received — cannot close channel",
      );
    }
    if (!this.leecherPubkey) {
      throw new Error("Leecher pubkey not set — verify channel first");
    }

    return this.state.channelClient.closeChannel({
      seeder: this.state.wallet,
      leecher: this.leecherPubkey,
      channelId: this.state.sessionKeys.channelId,
      amount: this.state.highestCheck.amount,
      nonce: this.state.highestCheck.nonce,
      signature: this.state.highestCheck.signature,
      seederTokenAccount: this.state.tokenAccount,
      leecherTokenAccount,
    });
  }

  destroyEphemeralKeys(): void {
    this.state.ephemeralKeys.secretKey.fill(0);
  }
}
