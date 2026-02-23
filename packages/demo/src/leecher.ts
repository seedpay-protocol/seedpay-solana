import { Keypair, PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { Seedpay } from "../../../target/types/seedpay";
import {
  generateEphemeralKeypair,
  deriveSessionKeys,
  signPaymentCheck,
  ChannelClient,
} from "../../sdk/src";
import type {
  EphemeralKeypair,
  SessionKeys,
  PaymentCheck,
  TxResult,
} from "../../sdk/src";
import type { DemoConfig } from "./config";

export interface LeecherState {
  ephemeralKeys: EphemeralKeypair;
  sessionKeys: SessionKeys | null;
  channelClient: ChannelClient;
  wallet: Keypair;
  tokenAccount: PublicKey;
  mint: PublicKey;
  checks: PaymentCheck[];
  nonce: number;
  bytesDownloaded: number;
  openResult: TxResult | null;
}

export class Leecher {
  public state: LeecherState;
  private config: DemoConfig;

  constructor(
    program: Program<Seedpay>,
    wallet: Keypair,
    tokenAccount: PublicKey,
    mint: PublicKey,
    config: DemoConfig,
  ) {
    this.config = config;
    this.state = {
      ephemeralKeys: generateEphemeralKeypair(),
      sessionKeys: null,
      channelClient: new ChannelClient(program),
      wallet,
      tokenAccount,
      mint,
      checks: [],
      nonce: 0,
      bytesDownloaded: 0,
      openResult: null,
    };
  }

  getEphemeralPublicKey(): Uint8Array {
    return this.state.ephemeralKeys.publicKey;
  }

  completeKeyExchange(seederEphemeralPk: Uint8Array): SessionKeys {
    const sessionKeys = deriveSessionKeys(
      this.state.ephemeralKeys.secretKey,
      seederEphemeralPk,
    );
    this.state.sessionKeys = sessionKeys;
    return sessionKeys;
  }

  async openChannel(seederWallet: PublicKey): Promise<TxResult> {
    if (!this.state.sessionKeys) {
      throw new Error("Must complete key exchange before opening channel");
    }

    const result = await this.state.channelClient.openChannel({
      leecher: this.state.wallet.publicKey,
      seeder: seederWallet,
      channelId: this.state.sessionKeys.channelId,
      amount: this.config.depositAmount,
      timeoutSeconds: this.config.timeoutSeconds,
      leecherTokenAccount: this.state.tokenAccount,
      mint: this.state.mint,
    });

    this.state.openResult = result;
    return result;
  }

  signCheck(cumulativeBytes: number): PaymentCheck {
    if (!this.state.sessionKeys) {
      throw new Error("Must complete key exchange before signing checks");
    }

    this.state.bytesDownloaded = cumulativeBytes;
    this.state.nonce += 1;

    const totalMb = cumulativeBytes / (1024 * 1024);
    const amount = BigInt(Math.ceil(totalMb * this.config.pricePerMbBaseUnits));

    const check = signPaymentCheck(
      this.state.sessionKeys.channelId,
      amount,
      BigInt(this.state.nonce),
      this.state.wallet.secretKey,
    );

    this.state.checks.push(check);
    return check;
  }

  getHighestCheck(): PaymentCheck | null {
    return this.state.checks.length > 0
      ? this.state.checks[this.state.checks.length - 1]
      : null;
  }

  async timeoutClose(seederWallet: PublicKey): Promise<TxResult> {
    if (!this.state.sessionKeys) {
      throw new Error("Must complete key exchange before timeout close");
    }

    return this.state.channelClient.timeoutClose({
      leecher: this.state.wallet.publicKey,
      seeder: seederWallet,
      channelId: this.state.sessionKeys.channelId,
      leecherTokenAccount: this.state.tokenAccount,
    });
  }

  destroyEphemeralKeys(): void {
    this.state.ephemeralKeys.secretKey.fill(0);
  }
}
