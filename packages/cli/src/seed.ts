import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { ChannelClient } from "@seedpay/sdk";
import {
  SeederController,
  createHandshakeMetadata,
  parseHandshakeMetadata,
  type HandshakeMetadata,
} from "@seedpay/bittorrent";
import { loadKeypair } from "./wallet";
import { resolveConfig, formatTokens, formatBytes } from "./config";
import { WebtorrentPeerTransport, createSeedPayExtension, type Wire } from "./transport";
import { SolanaChannelVerifier } from "./channel-adapters";
import { log, banner } from "./logger";

interface SeedOpts {
  wallet: string;
  price?: string;
  mint?: string;
  rpc?: string;
  port?: string;
}

export async function seedAction(file: string, opts: SeedOpts): Promise<void> {
  banner("SeedPay — Seed");

  const config = resolveConfig(opts);
  const wallet = loadKeypair(opts.wallet);
  const pricePerMb = opts.price ? BigInt(opts.price) : config.pricePerMb;

  log("SETUP", `Wallet: ${wallet.publicKey.toBase58().slice(0, 16)}...`);
  log("SETUP", `Price: ${formatTokens(pricePerMb)} tokens/MB`);
  log("SETUP", `RPC: ${config.rpcUrl}`);

  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  log("SETUP", `File: ${path.basename(filePath)} (${formatBytes(fs.statSync(filePath).size)})`);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" },
  );

  const idlPath = path.resolve(__dirname, "..", "..", "..", "target", "idl", "seedpay.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const channelClient = new ChannelClient(new Program(idl, provider) as any);

  const ata = await getOrCreateAssociatedTokenAccount(
    connection, wallet, config.mint, wallet.publicKey,
  );
  log("SETUP", `Token account: ${ata.address.toBase58().slice(0, 16)}...`);

  const activeControllers = new Map<string, SeederController>();

  const WebTorrent = (await import("webtorrent")).default;
  const client = new WebTorrent({ webSeeds: false, utp: false, lsd: false } as any) as any;

  log("TORRENT", "Creating torrent and starting seeding...");

  client.seed(filePath, { announceList: [] }, (torrent: any) => {
    log("TORRENT", `Info hash: ${torrent.infoHash}`);
    log("TORRENT", `Magnet: ${torrent.magnetURI.slice(0, 60)}...`);
    log("SEED", "Waiting for peers...");

    torrent.on("wire", (wire: Wire) => {
      const peerId = wire.peerId || wire.remoteAddress || "unknown";
      log("PEER", `Connected: ${peerId.slice(0, 16)}`);

      const verifier = new SolanaChannelVerifier(
        channelClient, wallet, ata.address, config.mint,
      );

      const metadata: HandshakeMetadata = {
        wallet: wallet.publicKey.toBase58(),
        pricePerMb,
        minPrepayment: pricePerMb * 10n,
        chain: "solana",
      };

      let controller: SeederController | null = null;

      wire.use(createSeedPayExtension({
        getHandshakeProps: () => createHandshakeMetadata(metadata),

        onHandshake: (_w: Wire, handshake: Record<string, unknown>) => {
          const remoteExtensions = (handshake.m || {}) as Record<string, number>;

          const remoteMeta = parseHandshakeMetadata(handshake);
          if (remoteMeta?.wallet) {
            try {
              verifier.setLeecherPubkey(new PublicKey(remoteMeta.wallet));
            } catch {
              log("PEER", `Invalid leecher wallet: ${remoteMeta.wallet}`);
              return;
            }
          }

          controller = new SeederController(
            new WebtorrentPeerTransport(wire),
            verifier,
            { session: { pricePerMb, checkFrequencyMb: config.checkFrequencyMb }, metadata },
          );

          if (!controller.onHandshake(remoteExtensions, handshake)) {
            log("PEER", "Peer does not support seedpay extension");
            return;
          }

          activeControllers.set(peerId, controller);
          log("PEER", `SeedPay handshake OK with ${peerId.slice(0, 16)}`);
        },

        onMessage: (_w: Wire, buf: Buffer) => {
          if (!controller) return;
          controller.onExtensionMessage(buf).catch((err) => {
            log("ERROR", `Extension message error: ${err.message}`);
          });
        },
      }));

      // Webtorrent fires upload events regardless of SeedPay channel state.
      // Only track once active — onPieceRequested() disconnects if not active.
      wire.on("upload", (length: number) => {
        if (!controller || controller.getSession().state !== "active") return;
        if (!controller.onPieceRequest(BigInt(length)).serve) {
          log("PAYMENT", `Choking peer ${peerId.slice(0, 16)} — payment required`);
        }
      });

      wire.on("close", () => {
        log("PEER", `Disconnected: ${peerId.slice(0, 16)}`);
        if (controller) {
          controller.onDisconnect().catch((err) => {
            log("ERROR", `Disconnect handler error: ${err.message}`);
          });
        }
        activeControllers.delete(peerId);
      });
    });
  });

  const shutdown = async () => {
    log("SHUTDOWN", "Closing active channels...");
    for (const [peerId, controller] of activeControllers) {
      try {
        if (controller.getSession().state === "active") {
          await controller.onDisconnect();
          log("SHUTDOWN", `Closed channel for ${peerId.slice(0, 16)}`);
        }
      } catch (err: any) {
        log("ERROR", `Failed to close channel for ${peerId.slice(0, 16)}: ${err.message}`);
      }
    }
    client.destroy(() => {
      log("SHUTDOWN", "Done");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
