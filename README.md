# kantiana-mcp

An [MCP](https://modelcontextprotocol.io) server for **lk.kantiana.ru** (BFU Kantiana personal account):

- profile, schedules (personal, group and teacher), notices, news, linked services

It runs as a stateless Cloudflare Worker using Streamable HTTP. The API client is [kantiana-api](https://github.com/mollyvita/kantiana-api).

> The Moodle tools (eios/lms.kantiana.ru) were removed: those hosts block Cloudflare Worker egress at the network level, so calls failed with `Network connection lost`.

## Tools

| Area | Tools |
| --- | --- |
| LK | `get_profile`, `get_schedule`, `search_groups`, `get_group_schedule`, `search_teachers`, `get_teacher_schedule`, `get_notices`, `dismiss_notice`, `get_news`, `get_services` |

## Deploy

```bash
npm install
npx wrangler secret put LK_LOGIN        # e.g. ivanov or ivanov@stud.kantiana.ru
npx wrangler secret put LK_PASSWORD
npx wrangler secret put MCP_AUTH_TOKEN  # required: the server acts as you
npm run deploy
```

Connect your MCP client to `https://kantiana-mcp.<subdomain>.workers.dev/mcp`. The client must send `Authorization: Bearer <token>`. Clients that can't set headers can append `?key=<token>` to the URL instead.

## Local development

```bash
printf 'LK_LOGIN=...\nLK_PASSWORD=...\n' > .dev.vars
npm run dev   # http://localhost:8787/mcp (no auth token needed on localhost)
```

Wrangler 4 requires Node 22 or newer.

## Notes

- Each Worker isolate caches the LK cookies for one hour, so the login flow doesn't run on every request. When an error looks like an auth problem, the cache is dropped and the next call logs in again.
