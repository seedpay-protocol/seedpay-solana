import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Ed25519Program,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { deriveChannelPDAs, ChannelPDAs } from "./pda";
import { encodePaymentCheckMessage } from "../payment-check";
import { Seedpay } from "../idl/seedpay";

export interface OpenChannelParams {
  leecher: PublicKey;
  seeder: PublicKey;
  channelId: Uint8Array;
  amount: bigint;
  timeoutSeconds: number;
  leecherTokenAccount: PublicKey;
  mint: PublicKey;
}

export interface CloseChannelParams {
  seeder: Keypair;
  leecher: PublicKey;
  channelId: Uint8Array;
  amount: bigint;
  nonce: bigint;
  seederTokenAccount: PublicKey;
  leecherTokenAccount: PublicKey;
  signature: Uint8Array;
}

export interface TimeoutCloseParams {
  leecher: PublicKey;
  seeder: PublicKey;
  channelId: Uint8Array;
  leecherTokenAccount: PublicKey;
}

export interface ChannelInfo {
  leecher: PublicKey;
  seeder: PublicKey;
  deposited: bigint;
  channelId: number[];
  createdAt: bigint;
  timeout: bigint;
  lastNonce: bigint;
  status: "open" | "closed" | "timedOut";
  bump: number;
  pdas: ChannelPDAs;
}

export interface TxResult {
  txSignature: string;
  pdas: ChannelPDAs;
}

export class ChannelClient {
  constructor(private readonly program: Program<Seedpay>) {}

  async openChannel(params: OpenChannelParams): Promise<TxResult> {
    const {
      leecher,
      seeder,
      channelId,
      amount,
      timeoutSeconds,
      leecherTokenAccount,
      mint,
    } = params;

    const pdas = deriveChannelPDAs(
      this.program.programId,
      leecher,
      seeder,
      channelId,
    );

    const txSignature = await this.program.methods
      .openChannel(
        Array.from(channelId),
        new BN(amount.toString()),
        new BN(timeoutSeconds),
      )
      .accounts({
        leecher,
        seeder,
        leecherTokenAccount,
        mint,
      })
      .rpc();

    return { txSignature, pdas };
  }

  async closeChannel(params: CloseChannelParams): Promise<TxResult> {
    const {
      seeder,
      leecher,
      channelId,
      amount,
      nonce,
      signature,
      seederTokenAccount,
      leecherTokenAccount,
    } = params;

    const pdas = deriveChannelPDAs(
      this.program.programId,
      leecher,
      seeder.publicKey,
      channelId,
    );

    const message = encodePaymentCheckMessage(channelId, amount, nonce);

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: leecher.toBytes(),
      message,
      signature,
    });

    const txSignature = await this.program.methods
      .closeChannel(new BN(amount.toString()), new BN(nonce.toString()))
      .accountsPartial({
        seeder: seeder.publicKey,
        leecher,
        channelState: pdas.channelState,
        seederTokenAccount,
        leecherTokenAccount,
      })
      .preInstructions([ed25519Ix])
      .signers([seeder])
      .rpc();

    return { txSignature, pdas };
  }

  async timeoutClose(params: TimeoutCloseParams): Promise<TxResult> {
    const { leecher, seeder, channelId, leecherTokenAccount } = params;

    const pdas = deriveChannelPDAs(
      this.program.programId,
      leecher,
      seeder,
      channelId,
    );

    const txSignature = await this.program.methods
      .timeoutClose()
      .accountsPartial({
        leecher,
        channelState: pdas.channelState,
        leecherTokenAccount,
      })
      .rpc();

    return { txSignature, pdas };
  }

  async fetchChannel(
    leecher: PublicKey,
    seeder: PublicKey,
    channelId: Uint8Array,
  ): Promise<ChannelInfo | null> {
    const pdas = deriveChannelPDAs(
      this.program.programId,
      leecher,
      seeder,
      channelId,
    );

    try {
      const raw = await this.program.account.channelState.fetch(pdas.channelState);

      let status: ChannelInfo["status"];
      if ("open" in raw.status) status = "open";
      else if ("closed" in raw.status) status = "closed";
      else status = "timedOut";

      return {
        leecher: raw.leecher,
        seeder: raw.seeder,
        deposited: BigInt(raw.deposited.toString()),
        channelId: raw.channelId,
        createdAt: BigInt(raw.createdAt.toString()),
        timeout: BigInt(raw.timeout.toString()),
        lastNonce: BigInt(raw.lastNonce.toString()),
        status,
        bump: raw.bump,
        pdas,
      };
    } catch {
      return null;
    }
  }
}
