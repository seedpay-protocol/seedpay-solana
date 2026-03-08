declare module "webtorrent" {
  class WebTorrent {
    constructor(opts?: Record<string, unknown>);
    add(torrentId: string, opts?: Record<string, unknown>): any;
    seed(input: string | string[] | Buffer, opts?: Record<string, unknown>, cb?: (torrent: any) => void): any;
    destroy(cb?: () => void): void;
  }
  export = WebTorrent;
}
