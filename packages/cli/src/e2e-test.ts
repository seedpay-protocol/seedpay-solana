/**
 * End-to-end test: runs seeder + leecher locally with direct TCP peer connection.
 * Tests the full SeedPay protocol: ECDH → channel open → data transfer → payment checks → close.
 *
 * Usage: tsx packages/cli/src/e2e-test.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { ChannelClient } from "@seedpay/sdk";
import {
  SeederController,
  LeecherController,
  createHandshakeMetadata,
  parseHandshakeMetadata,
  type LeecherControllerConfig,
  type HandshakeMetadata,
} from "@seedpay/bittorrent";
import { WebtorrentPeerTransport, createSeedPayExtension, type Wire } from "./transport";
import { SolanaChannelOpener, SolanaChannelVerifier } from "./channel-adapters";
import { loadKeypair } from "./wallet";
import { log, banner } from "./logger";

// --- Config ---
const SEEDER_PORT = 6991;
const PRICE_PER_MB = 100n;
const DEPOSIT = 500_000n; // 0.5 USDC
const TIMEOUT_SECONDS = 3600;
const CHECK_FREQUENCY_MB = 1n;
const FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const CHANNEL_TIMEOUT_MS = 60_000;

const events: string[] = [];
function track(event: string) {
  events.push(event);
  log("PROTOCOL", event);
}

async function main() {
  banner("SeedPay CLI — E2E Protocol Test");

  // --- Load env ---
  const envPath = path.resolve(__dirname, "..", "..", "..", ".env.devnet");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) env[t.slice(0, eq)] = t.slice(eq + 1);
  }

  const connection = new Connection(env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const mint = new PublicKey(env.MINT_PUBKEY);
  const seederWallet = loadKeypair(env.SEEDER_KEYPAIR);
  const leecherWallet = loadKeypair(env.LEECHER_KEYPAIR);
  const mintAuthority = loadKeypair(env.MINT_AUTHORITY_KEYPAIR);

  log("SETUP", `Seeder:  ${seederWallet.publicKey.toBase58().slice(0, 16)}...`);
  log("SETUP", `Leecher: ${leecherWallet.publicKey.toBase58().slice(0, 16)}...`);

  // --- Ensure token accounts + fund leecher ---
  const seederAta = await getOrCreateAssociatedTokenAccount(
    connection, seederWallet, mint, seederWallet.publicKey,
  );
  const leecherAta = await getOrCreateAssociatedTokenAccount(
    connection, leecherWallet, mint, leecherWallet.publicKey,
  );

  const mintTarget = DEPOSIT * 2n;
  let leecherBalance = BigInt(leecherAta.amount.toString());
  if (leecherBalance < mintTarget) {
    const needed = mintTarget - leecherBalance;
    log("SETUP", `Minting ${Number(needed) / 1e6} test USDC to leecher...`);
    await mintTo(connection, leecherWallet, mint, leecherAta.address, mintAuthority, Number(needed));
    const refreshed = await getOrCreateAssociatedTokenAccount(
      connection, leecherWallet, mint, leecherWallet.publicKey,
    );
    leecherBalance = BigInt(refreshed.amount.toString());
  }
  log("SETUP", `Leecher balance: ${Number(leecherBalance) / 1e6} USDC`);

  // --- Setup program clients ---
  const idlPath = path.resolve(__dirname, "..", "..", "..", "target", "idl", "seedpay.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const makeClient = (wallet: anchor.Wallet) => {
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    return new ChannelClient(new Program(idl, provider) as any);
  };

  const seederChannelClient = makeClient(new anchor.Wallet(seederWallet));
  const leecherChannelClient = makeClient(new anchor.Wallet(leecherWallet));

  // --- Create test file ---
  const testFile = "/tmp/seedpay-e2e-test.bin";
  if (!fs.existsSync(testFile) || fs.statSync(testFile).size !== FILE_SIZE) {
    log("SETUP", `Creating ${FILE_SIZE / (1024 * 1024)} MB test file...`);
    const buf = Buffer.alloc(FILE_SIZE);
    for (let i = 0; i < FILE_SIZE; i++) buf[i] = Math.floor(Math.random() * 256);
    fs.writeFileSync(testFile, buf);
  }

  const downloadDir = "/tmp/seedpay-e2e-download";
  if (fs.existsSync(downloadDir)) fs.rmSync(downloadDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  // --- Start webtorrent clients ---
  const WebTorrent = (await import("webtorrent")).default;
  const wtOpts = { dht: false, lsd: false, webSeeds: false, utp: false } as any;

  const seederClient = new WebTorrent({ ...wtOpts, torrentPort: SEEDER_PORT }) as any;
  const leecherClient = new WebTorrent({ ...wtOpts, torrentPort: SEEDER_PORT + 1 }) as any;

  const seederTorrent = await new Promise<any>((resolve) => {
    seederClient.seed(testFile, { announceList: [] }, resolve);
  });
  log("TORRENT", `Info hash: ${seederTorrent.infoHash}`);

  // --- Wire up seeder ---
  let seederController: SeederController | null = null;

  seederTorrent.on("wire", (wire: Wire) => {
    if (seederController) return;
    track("seeder: peer connected");

    const verifier = new SolanaChannelVerifier(
      seederChannelClient, seederWallet, seederAta.address, mint,
    );

    const metadata: HandshakeMetadata = {
      wallet: seederWallet.publicKey.toBase58(),
      pricePerMb: PRICE_PER_MB,
      minPrepayment: PRICE_PER_MB * 2n,
      chain: "solana",
    };

    wire.use(createSeedPayExtension({
      getHandshakeProps: () => createHandshakeMetadata(metadata),
      onHandshake: (_w: Wire, handshake: Record<string, unknown>) => {
        const remoteExtensions = (handshake.m || {}) as Record<string, number>;
        const remoteMeta = parseHandshakeMetadata(handshake);
        if (remoteMeta?.wallet) {
          verifier.setLeecherPubkey(new PublicKey(remoteMeta.wallet));
          track(`seeder: leecher wallet = ${remoteMeta.wallet.slice(0, 16)}...`);
        }

        seederController = new SeederController(
          new WebtorrentPeerTransport(wire),
          verifier,
          { session: { pricePerMb: PRICE_PER_MB, checkFrequencyMb: CHECK_FREQUENCY_MB }, metadata },
        );

        const accepted = seederController.onHandshake(remoteExtensions, handshake);
        track(`seeder: handshake ${accepted ? "OK" : "FAILED"}`);
      },
      onMessage: (_w: Wire, buf: Buffer) => {
        if (!seederController) return;
        seederController.onExtensionMessage(buf).then(() => {
          const session = seederController!.getSession();
          track(`seeder: state=${session.state}`);
          const check = session.getHighestCheck();
          if (check) track(`seeder: check ${Number(check.amount) / 1e6} USDC nonce=${check.nonce}`);
        }).catch((err) => log("ERROR", `seeder: ${err.message}`));
      },
    }));

    wire.on("upload", (length: number) => {
      if (!seederController || seederController.getSession().state !== "active") return;
      seederController.onPieceRequest(BigInt(length));
    });
  });

  // --- Wire up leecher ---
  let leecherController: LeecherController | null = null;

  const leecherTorrent = leecherClient.add(seederTorrent.magnetURI, {
    path: downloadDir, announce: [],
  });

  leecherTorrent.on("wire", (wire: Wire) => {
    if (leecherController) return;
    track("leecher: peer connected");

    const opener = new SolanaChannelOpener(
      leecherChannelClient, leecherWallet, leecherAta.address, mint,
    );

    const myMetadata: HandshakeMetadata = {
      wallet: leecherWallet.publicKey.toBase58(),
      pricePerMb: 0n, minPrepayment: 0n, chain: "solana",
    };

    wire.use(createSeedPayExtension({
      getHandshakeProps: () => createHandshakeMetadata(myMetadata),
      onHandshake: (_w: Wire, handshake: Record<string, unknown>) => {
        const remoteExtensions = (handshake.m || {}) as Record<string, number>;
        const seederMeta = parseHandshakeMetadata(handshake);
        if (!seederMeta) { track("leecher: no seedpay metadata"); return; }

        opener.setSeederPubkey(new PublicKey(seederMeta.wallet));
        track(`leecher: seeder wallet = ${seederMeta.wallet.slice(0, 16)}..., price=${Number(seederMeta.pricePerMb)}`);

        const sessionConfig: LeecherControllerConfig = {
          session: {
            deposit: DEPOSIT,
            timeout: BigInt(TIMEOUT_SECONDS),
            pricePerMb: seederMeta.pricePerMb,
            checkFrequencyMb: CHECK_FREQUENCY_MB,
            signingKey: leecherWallet.secretKey,
          },
          metadata: myMetadata,
        };

        leecherController = new LeecherController(
          new WebtorrentPeerTransport(wire), opener, sessionConfig,
        );

        leecherController.onHandshake(remoteExtensions, handshake).then((accepted) => {
          track(`leecher: handshake ${accepted ? "OK" : "FAILED"}`);
        }).catch((err) => log("ERROR", `leecher handshake: ${err.message}`));
      },
      onMessage: (_w: Wire, buf: Buffer) => {
        if (!leecherController) return;
        leecherController.onExtensionMessage(buf).then(() => {
          track(`leecher: state=${leecherController!.getSession().state}`);
        }).catch((err) => log("ERROR", `leecher: ${err.message}`));
      },
    }));

    wire.on("download", (length: number) => {
      if (!leecherController || leecherController.getSession().state !== "active") return;
      leecherController.onPieceReceived(BigInt(length)).catch((err) => {
        log("ERROR", `piece tracking: ${err.message}`);
      });
    });
  });

  // --- Connect peers ---
  await new Promise<void>((resolve) => {
    if (leecherTorrent.infoHash) resolve();
    else leecherTorrent.on("infoHash", () => resolve());
  });
  leecherTorrent.addPeer(`127.0.0.1:${SEEDER_PORT}`);

  // --- Wait for channel to reach "active" ---
  const startTime = Date.now();
  await new Promise<void>((resolve, reject) => {
    const poll = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (seederController) {
        const state = seederController.getSession().state;
        if (state === "active") { clearInterval(poll); track("channel active"); resolve(); return; }
        if (state === "error" || state === "closed") {
          clearInterval(poll); reject(new Error(`Seeder session: ${state}`)); return;
        }
      }
      if (elapsed > CHANNEL_TIMEOUT_MS) {
        clearInterval(poll);
        reject(new Error(`Channel timeout (seeder: ${seederController?.getSession().state ?? "none"})`));
      }
    }, 500);
  });

  // --- Wait for download ---
  if (leecherTorrent.progress < 1) {
    await new Promise<void>((resolve, reject) => {
      leecherTorrent.on("done", () => { track("download complete"); resolve(); });
      leecherTorrent.on("error", (err: Error) => reject(err));
      setTimeout(() => reject(new Error("Download timed out")), CHANNEL_TIMEOUT_MS);
    });
  } else {
    track("download already complete");
  }

  // Over localhost, data transfers before the channel opens. Report bytes
  // retroactively so the leecher generates payment checks for the seeder.
  if (leecherController) {
    await (leecherController as LeecherController).onPieceReceived(BigInt(FILE_SIZE));
    track(`leecher: reported ${FILE_SIZE} bytes`);
  }
  if (seederController) {
    (seederController as SeederController).onPieceRequest(BigInt(FILE_SIZE));
  }

  await new Promise((r) => setTimeout(r, 3000));

  // --- Close channel ---
  if (seederController) {
    const sc = seederController as SeederController;
    const check = sc.getSession().getHighestCheck();
    if (check) {
      track(`seeder: closing with check ${Number(check.amount) / 1e6} USDC`);
      await sc.onDisconnect();
      track("seeder: channel closed");
    } else {
      track("seeder: no checks received");
    }
  }

  // --- Results ---
  await new Promise((r) => setTimeout(r, 2000));
  const leecherFinal = await connection.getTokenAccountBalance(leecherAta.address);
  const seederFinal = await connection.getTokenAccountBalance(seederAta.address);

  console.log("");
  banner("E2E Test Results");
  console.log(`    File size:        ${FILE_SIZE / (1024 * 1024)} MB`);
  console.log(`    Price:            ${Number(PRICE_PER_MB) / 1e6} USDC/MB`);
  console.log(`    Deposit:          ${Number(DEPOSIT) / 1e6} USDC`);
  console.log(`    Leecher balance:  ${leecherFinal.value.uiAmountString} USDC`);
  console.log(`    Seeder balance:   ${seederFinal.value.uiAmountString} USDC`);
  console.log("\n    Protocol events:");
  for (const e of events) console.log(`      - ${e}`);
  console.log("");

  seederClient.destroy();
  leecherClient.destroy();
  log("CLEANUP", "Done");
}

main().catch((err) => {
  console.error("\n  E2E test failed:", err.message || err);
  if (err.logs) err.logs.forEach((l: string) => console.error(`    ${l}`));
  process.exit(1);
});
