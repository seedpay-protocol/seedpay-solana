import {
  SeederSession,
  type SessionAction,
  type SeederSessionConfig,
  type PaymentCheckMessage,
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

export interface VerifiedChannel {
  valid: boolean;
  leecherPubkey?: Uint8Array;
  deposited?: bigint;
}

export interface ChannelVerifier {
  verifyChannel(channelId: Uint8Array, txSignature: string): Promise<VerifiedChannel>;
  closeChannel(channelId: Uint8Array, check: {
    channelId: Uint8Array;
    amount: bigint;
    nonce: bigint;
    signature: Uint8Array;
  }): Promise<string>;
}

export interface SeederControllerConfig {
  session: SeederSessionConfig;
  metadata: HandshakeMetadata;
}

export class SeederController {
  private session: SeederSession;
  private negotiator: ExtensionNegotiator;
  private transport: PeerTransport;
  private verifier: ChannelVerifier;
  private metadata: HandshakeMetadata;
  private remoteMeta: HandshakeMetadata | null = null;

  constructor(
    transport: PeerTransport,
    verifier: ChannelVerifier,
    config: SeederControllerConfig,
  ) {
    this.session = new SeederSession(config.session);
    this.negotiator = new ExtensionNegotiator();
    this.transport = transport;
    this.verifier = verifier;
    this.metadata = config.metadata;
  }

  getLocalHandshakeEntry(): Record<string, number> {
    return this.negotiator.getLocalHandshakeEntry();
  }

  getLocalMetadata(): Record<string, string> {
    return createHandshakeMetadata(this.metadata);
  }

  onHandshake(
    remoteExtensions: Record<string, number>,
    remoteMeta: Record<string, unknown>,
  ): boolean {
    if (!this.negotiator.processRemoteHandshake(remoteExtensions)) {
      return false;
    }
    this.remoteMeta = parseHandshakeMetadata(remoteMeta);
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
      case "channel_opened": {
        const actions = this.session.onChannelOpened(msg.txSignature);
        await this.executeActions(actions);
        break;
      }
      case "payment_check": {
        const actions = this.session.onPaymentCheck(msg as PaymentCheckMessage);
        await this.executeActions(actions);
        break;
      }
      case "channel_closed": {
        const actions = this.session.onChannelClosed();
        await this.executeActions(actions);
        break;
      }
      default:
        break;
    }
  }

  onPieceRequest(pieceLength: bigint): { serve: boolean } {
    const actions = this.session.onPieceRequested(pieceLength);
    const hasPaymentRequired = actions.some(
      (a) => a.action === "send_message" && a.message.type === "payment_check_required",
    );

    for (const action of actions) {
      if (action.action === "send_message") {
        this.sendMessage(action);
      }
    }

    return { serve: !hasPaymentRequired };
  }

  async onDisconnect(): Promise<void> {
    const actions = this.session.onDisconnect();
    await this.executeActions(actions);
  }

  getSession(): SeederSession {
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
        case "verify_channel": {
          const result = await this.verifier.verifyChannel(
            action.channelId,
            action.txSignature,
          );
          if (result.valid && result.leecherPubkey && result.deposited !== undefined) {
            const confirmActions = this.session.confirmChannel(
              result.deposited,
              result.leecherPubkey,
            );
            for (const a of confirmActions) {
              if (a.action === "send_message") this.sendMessage(a);
            }
          } else {
            const rejectActions = this.session.rejectChannel("Channel verification failed");
            for (const a of rejectActions) {
              if (a.action === "send_message") this.sendMessage(a);
            }
          }
          break;
        }
        case "close_channel": {
          await this.verifier.closeChannel(action.channelId, action.check);
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
