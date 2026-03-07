export interface PeerTransport {
  sendExtensionMessage(extensionId: number, data: Uint8Array): void;
  disconnect(): void;
}
