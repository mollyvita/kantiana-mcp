import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ClientProvider, type Env } from "./session.js";
import { registerTools } from "./tools.js";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version",
    "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function authorized(request: Request, url: URL, env: Env): boolean {
  if (!env.MCP_AUTH_TOKEN) return true;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return bearer === env.MCP_AUTH_TOKEN || url.searchParams.get("key") === env.MCP_AUTH_TOKEN;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({ status: "ok", service: "kantiana-mcp" });
    }

    if (url.pathname === "/mcp") {
      if (!authorized(request, url, env)) return jsonResponse({ error: "unauthorized" }, 401);

      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = new McpServer({ name: "kantiana-mcp", version: "0.1.0" });
      registerTools(server, new ClientProvider(env), { hasSecrets: Boolean(env.LK_LOGIN && env.LK_PASSWORD) });
      await server.connect(transport);

      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders() });
  },
} satisfies ExportedHandler<Env>;
