/**
 * Minimal typings for the `ws` package, which is already installed (transitively) but ships no
 * types and has no `@types/ws` here: the deployment server cannot download new packages. Only
 * the surface the live-view endpoint and its tests use is declared.
 */
declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export class WebSocket {
    static readonly OPEN: number;
    readonly OPEN: number;
    readonly readyState: number;
    readonly bufferedAmount: number;
    constructor(address: string, options?: { headers?: Record<string, string> });
    send(data: string | Buffer | ArrayBuffer, options?: { binary?: boolean }): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    on(event: "message", listener: (data: RawData, isBinary: boolean) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "open", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    once(event: "message", listener: (data: RawData, isBinary: boolean) => void): this;
    once(event: "close", listener: (code: number, reason: Buffer) => void): this;
    once(event: "open", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { noServer: true } | { server: unknown; path?: string });
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (socket: WebSocket, request: IncomingMessage) => void): void;
    on(event: "connection", listener: (socket: WebSocket, request: IncomingMessage) => void): this;
    close(): void;
  }
}
