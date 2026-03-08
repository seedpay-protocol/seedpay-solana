import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { ChannelClient } from "@seedpay/sdk";
import {
  LeecherController,
  createHandshakeMetadata,
  parseHandshakeMetadata,
  type LeecherControllerConfig,
  type HandshakeMetadata,
} from "@seedpay/bittorrent";
import { loadKeypair } from "./wallet";
import { resolveConfig, formatTokens, formatBytes } from "./config";
import { WebtorrentPeerTransport, createSeedPayExtension, type Wire } from "./transport";
import { SolanaChannelOpener } from "./channel-adapters";
import { log, banner } from "./logger";

interface DownloadOpts {
  wallet: string;
  deposit?: string;
  maxPrice?: string;
  mint?: string;
  rpc?: string;
  output?: string;
}

export async function downloadAction(
  torrentOrMagnet: string,
  opts: DownloadOpts,
): Promise<void> {
  banner("SeedPay — Download");

  const config = resolveConfig(opts);
  const wallet = loadKeypair(opts.wallet);

  log("SETUP", `Wallet: ${wallet.publicKey.toBase58().slice(0, 16)}...`);
  log("SETUP", `Deposit: ${formatTokens(config.deposit)} tokens`);
  log("SETUP", `RPC: ${config.rpcUrl}`);

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

  const balance = BigInt(ata.amount.toString());
  if (balance < config.deposit) {
    throw new Error(
      `Insufficient token balance: ${formatTokens(balance)} < ${formatTokens(config.deposit)} deposit`,
    );
  }
  log("SETUP", `Balance: ${formatTokens(balance)} tokens`);

  const maxPricePerMb = opts.maxPrice ? BigInt(opts.maxPrice) : undefined;
  const outputDir = opts.output || ".";

  const activeControllers = new Map<string, LeecherController>();

  const WebTorrent = (await import("webtorrent")).default;
  const client = new WebTorrent({ webSeeds: false, utp: false, lsd: false } as any) as any;

  log("TORRENT", "Adding torrent...");

  const torrent = client.add(torrentOrMagnet, { path: outputDir });

  torrent.on("infoHash", () => log("TORRENT", `Info hash: ${torrent.infoHash}`));
  torrent.on("metadata", () => {
    log("TORRENT", `Name: ${torrent.name}`);
    log("TORRENT", `Size: ${formatBytes(torrent.length)}`);
  });

  torrent.on("wire", (wire: Wire) => {
    const peerId = wire.peerId || wire.remoteAddress || "unknown";
    log("PEER", `Connected: ${peerId.slice(0, 16)}`);

    const opener = new SolanaChannelOpener(channelClient, wallet, ata.address, config.mint);
    let controller: LeecherController | null = null;

    const myMetadata: HandshakeMetadata = {
      wallet: wallet.publicKey.toBase58(),
      pricePerMb: 0n,
      minPrepayment: 0n,
      chain: "solana",
    };

    wire.use(createSeedPayExtension({
      getHandshakeProps: () => createHandshakeMetadata(myMetadata),

      onHandshake: (_w: Wire, handshake: Record<string, unknown>) => {
        const remoteExtensions = (handshake.m || {}) as Record<string, number>;

        const seederMeta = parseHandshakeMetadata(handshake);
        if (!seederMeta) {
          log("PEER", "Peer missing seedpay metadata, skipping payment channel");
          return;
        }

        try {
          opener.setSeederPubkey(new PublicKey(seederMeta.wallet));
        } catch {
          log("PEER", `Invalid seeder wallet: ${seederMeta.wallet}`);
          return;
        }

        log("PEER", `Seeder price: ${formatTokens(seederMeta.pricePerMb)} tokens/MB`);

        const sessionConfig: LeecherControllerConfig = {
          session: {
            deposit: config.deposit,
            timeout: BigInt(config.timeoutSeconds),
            pricePerMb: seederMeta.pricePerMb,
            checkFrequencyMb: config.checkFrequencyMb,
            signingKey: wallet.secretKey,
          },
          metadata: myMetadata,
          maxPricePerMb,
        };

        controller = new LeecherController(
          new WebtorrentPeerTransport(wire),
          opener,
          sessionConfig,
        );

        controller.onHandshake(remoteExtensions, handshake).then((accepted) => {
          if (accepted) {
            activeControllers.set(peerId, controller!);
            log("PEER", `SeedPay handshake OK with ${peerId.slice(0, 16)}`);
          } else {
            log("PEER", `SeedPay rejected by ${peerId.slice(0, 16)}`);
          }
        }).catch((err) => {
          log("ERROR", `Handshake error: ${err.message}`);
        });
      },

      onMessage: (_w: Wire, buf: Buffer) => {
        if (!controller) return;
        controller.onExtensionMessage(buf).catch((err) => {
          log("ERROR", `Extension message error: ${err.message}`);
        });
      },
    }));

    // Webtorrent fires download events regardless of SeedPay channel state.
    // Only track once active — onPieceReceived() disconnects if not active.
    wire.on("download", (length: number) => {
      if (!controller || controller.getSession().state !== "active") return;
      controller.onPieceReceived(BigInt(length)).catch((err) => {
        log("ERROR", `Piece tracking error: ${err.message}`);
      });
    });

    wire.on("close", () => {
      log("PEER", `Disconnected: ${peerId.slice(0, 16)}`);
      if (controller) controller.onDisconnect();
      activeControllers.delete(peerId);
    });
  });

  torrent.on("download", () => {
    const pct = (torrent.progress * 100).toFixed(1);
    const speed = formatBytes(torrent.downloadSpeed) + "/s";
    process.stdout.write(`\r  Progress: ${pct}% | Speed: ${speed}   `);
  });

  torrent.on("done", () => {
    process.stdout.write("\n");
    log("DONE", `Download complete: ${torrent.name}`);
    log("DONE", `Saved to: ${path.resolve(outputDir, torrent.name)}`);

    for (const controller of activeControllers.values()) {
      controller.onComplete();
    }

    setTimeout(() => {
      client.destroy(() => process.exit(0));
    }, 3000);
  });

  torrent.on("error", (err: Error) => log("ERROR", `Torrent error: ${err.message}`));

  const shutdown = () => {
    log("SHUTDOWN", "Stopping download...");
    for (const controller of activeControllers.values()) {
      controller.onDisconnect();
    }
    client.destroy(() => {
      log("SHUTDOWN", "Done");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
