import type { PeerTransport } from "@seedpay/bittorrent";

/**
 * Webtorrent wire interface (subset we use).
 * Webtorrent doesn't ship good types, so we define what we need.
 */
export interface Wire {
  extended(name: string, data: Buffer | Uint8Array): void;
  destroy(): void;
  use(extension: (wire: any) => any): void;
  on(event: string, handler: (...args: any[]) => void): void;
  once(event: string, handler: (...args: any[]) => void): void;
  removeListener(event: string, handler: (...args: any[]) => void): void;
  peerExtendedMapping: Record<string, number>;
  peerId?: string;
  remoteAddress?: string;
}

export class WebtorrentPeerTransport implements PeerTransport {
  constructor(private wire: Wire) {}

  sendExtensionMessage(_extensionId: number, data: Uint8Array): void {
    // Webtorrent resolves the numeric extension ID internally via the
    // extension name from the BEP 10 handshake. We always use "seedpay".
    this.wire.extended("seedpay", Buffer.from(data));
  }

  disconnect(): void {
    this.wire.destroy();
  }

  // choke/unchoke intentionally omitted — webtorrent tears down connections
  // when peers are choked, making wire-level choking unusable for payment gating.
  // Instead, piece serving is gated via SeederController.onPieceRequest().
  choke(): void {}
  unchoke(): void {}
}

/**
 * Creates a webtorrent BEP 10 extension class.
 *
 * bittorrent-protocol requires `Extension.prototype.name` and calls `new Extension(wire)`.
 */
export function createSeedPayExtension(handlers: {
  onHandshake: (wire: Wire, handshake: Record<string, unknown>) => void;
  onMessage: (wire: Wire, buf: Buffer) => void;
  getHandshakeProps: () => Record<string, unknown>;
}) {
  function SeedPayExtension(this: any, wire: Wire) {
    this._wire = wire;
    const props = handlers.getHandshakeProps();
    for (const [key, value] of Object.entries(props)) {
      (wire as any).extendedHandshake[key] = value;
    }
  }

  SeedPayExtension.prototype.name = "seedpay";

  SeedPayExtension.prototype.onExtendedHandshake = function (
    handshake: Record<string, unknown>,
  ) {
    handlers.onHandshake(this._wire, handshake);
  };

  SeedPayExtension.prototype.onMessage = function (buf: Buffer) {
    handlers.onMessage(this._wire, buf);
  };

  return SeedPayExtension;
}
