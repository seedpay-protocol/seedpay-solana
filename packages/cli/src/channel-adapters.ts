import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { ChannelClient } from "@seedpay/sdk";
import type { ChannelOpener, ChannelVerifier, VerifiedChannel } from "@seedpay/bittorrent";

export class SolanaChannelOpener implements ChannelOpener {
  private seederPubkey: PublicKey | null = null;

  constructor(
    private channelClient: ChannelClient,
    private wallet: Keypair,
    private leecherTokenAccount: PublicKey,
    private mint: PublicKey,
  ) {}

  setSeederPubkey(pubkey: PublicKey): void {
    this.seederPubkey = pubkey;
  }

  async openChannel(
    channelId: Uint8Array,
    deposit: bigint,
    timeout: bigint,
  ): Promise<string> {
    if (!this.seederPubkey) {
      throw new Error("Seeder public key not set — handshake incomplete");
    }

    const result = await this.channelClient.openChannel({
      leecher: this.wallet.publicKey,
      seeder: this.seederPubkey,
      channelId,
      amount: deposit,
      timeoutSeconds: Number(timeout),
      leecherTokenAccount: this.leecherTokenAccount,
      mint: this.mint,
    });
    return result.txSignature;
  }
}

export class SolanaChannelVerifier implements ChannelVerifier {
  private leecherPubkey: PublicKey | null = null;

  constructor(
    private channelClient: ChannelClient,
    private seederKeypair: Keypair,
    private seederTokenAccount: PublicKey,
    private mint: PublicKey,
  ) {}

  setLeecherPubkey(pubkey: PublicKey): void {
    this.leecherPubkey = pubkey;
  }

  async verifyChannel(
    channelId: Uint8Array,
    _txSignature: string,
  ): Promise<VerifiedChannel> {
    if (!this.leecherPubkey) {
      return { valid: false };
    }

    const info = await this.channelClient.fetchChannel(
      this.leecherPubkey,
      this.seederKeypair.publicKey,
      channelId,
    );

    if (!info || info.status !== "open") {
      return { valid: false };
    }

    return {
      valid: true,
      leecherPubkey: this.leecherPubkey.toBytes(),
      deposited: info.deposited,
    };
  }

  async closeChannel(
    channelId: Uint8Array,
    check: {
      channelId: Uint8Array;
      amount: bigint;
      nonce: bigint;
      signature: Uint8Array;
    },
  ): Promise<string> {
    if (!this.leecherPubkey) {
      throw new Error("Leecher public key not set");
    }

    const leecherTokenAccount = await getAssociatedTokenAddress(
      this.mint,
      this.leecherPubkey,
    );

    const result = await this.channelClient.closeChannel({
      seeder: this.seederKeypair,
      leecher: this.leecherPubkey,
      channelId,
      amount: check.amount,
      nonce: check.nonce,
      signature: check.signature,
      seederTokenAccount: this.seederTokenAccount,
      leecherTokenAccount,
    });
    return result.txSignature;
  }
}
