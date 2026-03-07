import {
  LeecherSession,
  type SessionAction,
  type LeecherSessionConfig,
} from "@seedpay/sdk";
import {
  encodeBep10Message,
  decodeBep10Message,
  ExtensionNegotiator,
  parseHandshakeMetadata,
  createHandshakeMetadata,
  type HandshakeMetadata,
} from "./extension";
import type { PeerTransport } from "./transport";

export interface ChannelOpener {
  openChannel(channelId: Uint8Array, deposit: bigint, timeout: bigint): Promise<string>;
}

export interface LeecherControllerConfig {
  session: LeecherSessionConfig;
  metadata: HandshakeMetadata;
  maxPricePerMb?: bigint;
}

export class LeecherController {
  private session: LeecherSession;
  private negotiator: ExtensionNegotiator;
  private transport: PeerTransport;
  private opener: ChannelOpener;
  private metadata: HandshakeMetadata;
  private maxPricePerMb: bigint | null;
  private remoteMeta: HandshakeMetadata | null = null;

  constructor(
    transport: PeerTransport,
    opener: ChannelOpener,
    config: LeecherControllerConfig,
  ) {
    this.session = new LeecherSession(config.session);
    this.negotiator = new ExtensionNegotiator(2);
    this.transport = transport;
    this.opener = opener;
    this.metadata = config.metadata;
    this.maxPricePerMb = config.maxPricePerMb ?? null;
  }

  getLocalHandshakeEntry(): Record<string, number> {
    return this.negotiator.getLocalHandshakeEntry();
  }

  getLocalMetadata(): Record<string, string> {
    return createHandshakeMetadata(this.metadata);
  }

  async onHandshake(
    remoteExtensions: Record<string, number>,
    remoteMeta: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.negotiator.processRemoteHandshake(remoteExtensions)) {
      return false;
    }

    this.remoteMeta = parseHandshakeMetadata(remoteMeta);

    if (this.maxPricePerMb !== null && this.remoteMeta) {
      if (this.remoteMeta.pricePerMb > this.maxPricePerMb) {
        this.transport.disconnect();
        return false;
      }
    }

    const actions = this.session.start();
    await this.executeActions(actions);
    return true;
  }

  async onExtensionMessage(data: Uint8Array): Promise<void> {
    const msg = decodeBep10Message(data);

    switch (msg.type) {
      case "ecdh_init": {
        const actions = this.session.onEcdhInit(msg.publicKey);
        await this.executeActions(actions);
        break;
      }
      case "channel_confirmed": {
        const actions = this.session.onChannelConfirmed();
        await this.executeActions(actions);
        break;
      }
      case "channel_rejected": {
        const actions = this.session.onChannelRejected(msg.reason);
        await this.executeActions(actions);
        break;
      }
      case "payment_check_required": {
        const actions = this.session.onPaymentCheckRequired();
        await this.executeActions(actions);
        break;
      }
      case "payment_check_rejected": {
        // Log but don't crash — seeder may continue
        break;
      }
      case "channel_closed": {
        const actions = this.session.onChannelClosed();
        await this.executeActions(actions);
        break;
      }
      case "channel_timeout_warning": {
        // Informational — caller can hook into this
        break;
      }
      default:
        break;
    }
  }

  async onPieceReceived(pieceLength: bigint): Promise<void> {
    const actions = this.session.onPieceReceived(pieceLength);
    await this.executeActions(actions);
  }

  onComplete(): void {
    this.session.onChannelClosed();
  }

  onDisconnect(): void {
    this.session.onChannelClosed();
  }

  getSession(): LeecherSession {
    return this.session;
  }

  getRemoteMetadata(): HandshakeMetadata | null {
    return this.remoteMeta;
  }

  private async executeActions(actions: SessionAction[]): Promise<void> {
    for (const action of actions) {
      switch (action.action) {
        case "send_message":
          this.sendMessage(action);
          break;
        case "open_channel": {
          const txSig = await this.opener.openChannel(
            action.channelId,
            action.deposit,
            action.timeout,
          );
          const openedActions = this.session.onChannelOpened(txSig);
          for (const a of openedActions) {
            if (a.action === "send_message") this.sendMessage(a);
          }
          break;
        }
        case "error":
          this.transport.disconnect();
          break;
      }
    }
  }

  private sendMessage(action: { action: "send_message"; message: any }): void {
    const remoteId = this.negotiator.getRemoteId();
    if (remoteId === null) return;
    const encoded = encodeBep10Message(action.message);
    this.transport.sendExtensionMessage(remoteId, encoded);
  }
}
