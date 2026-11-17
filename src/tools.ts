import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClientProvider } from "./session.js";
import { formatSchedule, json, stripHtml, text } from "./format.js";

const AUTH_ERROR_CODES = new Set(["invalidtoken", "servicerequireslogin", "requireloginerror", "invalidsesskey"]);

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (default: today)");
const daysArg = z.number().int().min(1).max(31).default(1).describe("Number of consecutive days");

function dayList(from: string | undefined, days: number): Date[] {
  const start = from ? new Date(`${from}T12:00:00Z`) : new Date();
  return Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 86400000));
}

export function registerTools(server: McpServer, clients: ClientProvider) {
  const safe =
    <A,>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const { status, code } = (e ?? {}) as { status?: number; code?: string };
        if (status === 401 || AUTH_ERROR_CODES.has(code ?? "") || /not authenticated|invalid token|session/i.test(msg)) clients.reset();
        return { ...text(`Error: ${msg}`), isError: true };
      }
    };

  // ---------- lk.kantiana.ru ----------

  server.tool("get_profile", "Student profile from lk.kantiana.ru: name, group, program, course, e-mails.", {}, safe(async () => json(await (await clients.lk()).profile())));

  server.tool(
    "get_schedule",
    "Personal class schedule (lk.kantiana.ru).",
    { date: dateArg, days: daysArg },
    safe(async ({ date, days }) => {
      const lk = await clients.lk();
      const res = (await Promise.all(dayList(date, days).map((d) => lk.schedule(d)))).flat();
      return text(formatSchedule(res));
    }),
  );

  server.tool(
    "search_groups",
    "Find study groups by substring (e.g. 'ФИИТ'). Returns group ids usable in get_group_schedule.",
    { query: z.string().default("") },
    safe(async ({ query }) => {
      const groups = await (await clients.lk()).groups();
      const q = query.toLowerCase();
      const hits = groups.filter((g) => g.toLowerCase().includes(q));
      return text(`${hits.length} groups\n${hits.slice(0, 200).join("\n")}`);
    }),
  );

  server.tool(
    "get_group_schedule",
    "Schedule of any study group.",
    { group: z.string().describe("Group id, e.g. 03_ФИИТ_26_1"), date: dateArg, days: daysArg },
    safe(async ({ group, date, days }) => {
      const lk = await clients.lk();
      const res = (await Promise.all(dayList(date, days).map((d) => lk.groupSchedule(group, d)))).flat();
      return text(formatSchedule(res));
    }),
  );

  server.tool(
    "search_teachers",
    "Search teachers by name. Returns ids for get_teacher_schedule.",
    { query: z.string() },
    safe(async ({ query }) => {
      const res = await (await clients.lk()).searchTeachers(query);
      return text(
        res.items.map((t) => `${t.onec_univer_id}  ${[t.surname, t.name, t.patronymic].filter(Boolean).join(" ")}`).join("\n") ||
          "No teachers found.",
      );
    }),
  );

  server.tool(
    "get_teacher_schedule",
    "Schedule of a teacher.",
    { teacher_id: z.string().describe("onec_univer_id from search_teachers"), date: dateArg, days: daysArg },
    safe(async ({ teacher_id, date, days }) => {
      const lk = await clients.lk();
      const res = (await Promise.all(dayList(date, days).map((d) => lk.teacherSchedule(teacher_id, d)))).flat();
      return text(formatSchedule(res));
    }),
  );

  server.tool(
    "get_notices",
    "Notices from lk.kantiana.ru (e.g. MFC document request statuses).",
    { count: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0), active_only: z.boolean().optional() },
    safe(async ({ count, offset, active_only }) => json(await (await clients.lk()).notices({ count, offset, active: active_only }))),
  );

  server.tool(
    "dismiss_notice",
    "Mark an lk.kantiana.ru notice as read/dismissed.",
    { id: z.string() },
    safe(async ({ id }) => {
      await (await clients.lk()).dismissNotice(id);
      return text("Dismissed.");
    }),
  );

  server.tool(
    "get_news",
    "University news feed from lk.kantiana.ru.",
    { count: z.number().int().min(1).max(50).default(10), offset: z.number().int().min(0).default(0) },
    safe(async ({ count, offset }) => {
      const res = await (await clients.lk()).news({ count, offset });
      return json({
        total: res.total,
        items: res.items.map((n) => ({ ...n, description: stripHtml(n.description) })),
      });
    }),
  );

  server.tool(
    "get_services",
    "Linked university services (eios, MFC, communities, ...) available to the account. SSO URLs are omitted.",
    {},
    safe(async () => {
      const { services } = await (await clients.lk()).services();
      return json(services.map((s) => ({ name: s.name, role: s.role, available: Boolean(s.url) })));
    }),
  );

}
