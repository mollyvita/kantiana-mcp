import { KantianaClient, type KantianaSession } from "kantiana-api";

export interface Env {
  LK_LOGIN?: string;
  LK_PASSWORD?: string;
  MCP_AUTH_TOKEN?: string;
}

const SESSION_TTL_MS = 60 * 60 * 1000;

// Isolate-level cache: avoids re-running the LK login + eios SSO dance on every request.
let cached: { session: KantianaSession; at: number; login: string } | null = null;

/** Holds a lazily-authenticated client for one MCP request. */
export class ClientProvider {
  private client: KantianaClient | null = null;

  constructor(private readonly env: Env) {}

  private async base(): Promise<KantianaClient> {
    if (this.client) return this.client;
    const { LK_LOGIN, LK_PASSWORD } = this.env;
    if (cached && LK_LOGIN && cached.login === LK_LOGIN && Date.now() - cached.at < SESSION_TTL_MS) {
      this.client = KantianaClient.fromSession(cached.session);
      return this.client;
    }
    const client = new KantianaClient();
    if (LK_LOGIN && LK_PASSWORD) await client.login(LK_LOGIN, LK_PASSWORD);
    this.client = client;
    this.save();
    return client;
  }

  async lk(): Promise<KantianaClient["lk"]> {
    const c = await this.base();
    if (!c.lk.isAuthenticated) throw new Error("Not logged in. Configure the LK_LOGIN/LK_PASSWORD Worker secrets.");
    return c.lk;
  }

  /** Drops cached auth so the next call re-authenticates (e.g. after the LK cookie expired). */
  reset(): void {
    cached = null;
    this.client = null;
  }

  private save(): void {
    if (this.client && this.env.LK_LOGIN && this.client.lk.isAuthenticated) {
      cached = { session: this.client.exportSession(), at: Date.now(), login: this.env.LK_LOGIN };
    }
  }
}
