import { PublicKey } from "@solana/web3.js";

export interface ChannelPDAs {
  channelState: PublicKey;
  channelStateBump: number;

  escrow: PublicKey;
  escrowBump: number;

  authority: PublicKey;
  authorityBump: number;
}

export const deriveChannelPDAs = (
  programId: PublicKey,
  leecher: PublicKey,
  seeder: PublicKey,
  channelId: Uint8Array,
): ChannelPDAs => {
  const [channelState, channelStateBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("channel"),
      leecher.toBuffer(),
      seeder.toBuffer(),
      Buffer.from(channelId),
    ],
    programId,
  );

  const [escrow, escrowBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), channelState.toBuffer()],
    programId,
  );

  const [authority, authorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("authority")],
    programId,
  );

  return {
    channelState,
    channelStateBump,
    escrow,
    escrowBump,
    authority,
    authorityBump,
  };
};
