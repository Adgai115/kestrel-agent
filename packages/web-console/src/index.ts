/**
 * @kestrel/web-console — Web admin panel for Kestrel Agent.
 *
 * React + Vite + Tailwind + shadcn/ui. Phase 12 scaffold.
 */

export class ConsoleApi {
  constructor(private config: { gatewayUrl: string; token: string }) {}

  async health(): Promise<unknown> {
    return (await fetch(`${this.config.gatewayUrl}/health`)).json();
  }
  async status(): Promise<unknown> {
    const res = await fetch(`${this.config.gatewayUrl}/status`, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    return res.json();
  }
}

export const KESTREL_WEB_CONSOLE_VERSION = "0.1.0";
