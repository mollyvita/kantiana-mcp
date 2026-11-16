import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleArgs, MoodleSection } from "kantiana-api";
import type { ClientProvider } from "./session.js";
import { formatDate, formatSchedule, json, stripHtml, text } from "./format.js";

const MAX_INLINE_BYTES = 5 * 1024 * 1024;

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (default: today)");
const daysArg = z.number().int().min(1).max(31).default(1).describe("Number of consecutive days");
const site = z.enum(["eios", "lms"]).default("eios").describe("Moodle site: eios.kantiana.ru (courses) or lms.kantiana.ru");

function dayList(from: string | undefined, days: number): Date[] {
  const start = from ? new Date(`${from}T12:00:00Z`) : new Date();
  return Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 86400000));
}

function summarizeContents(sections: MoodleSection[]): string {
  return sections
    .map((s) => {
      const mods = s.modules.map((m) => {
        const files = (m.contents ?? [])
          .filter((c) => c.type === "file")
          .map((c) => `\n        file: ${c.filename}${c.filesize ? ` (${Math.round(c.filesize / 1024)} KB)` : ""} — ${c.fileurl}`)
          .join("");
        const desc = stripHtml(m.description);
        const dates = (m.dates ?? []).map((d) => `${d.label} ${formatDate(d.timestamp)}`).join("; ");
        return `    - [${m.modname} cmid=${m.id} instance=${m.instance}] ${m.name}${dates ? ` (${dates})` : ""}${desc ? `\n        ${desc.slice(0, 300)}` : ""}${files}`;
      });
      const summary = stripHtml(s.summary);
      return `## ${s.name || `Section ${s.section}`}${summary ? `\n${summary.slice(0, 500)}` : ""}\n${mods.join("\n")}`;
    })
    .join("\n\n");
}

export function registerTools(server: McpServer, clients: ClientProvider) {
  const safe =
    <A,>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/401|not authenticated|invalidtoken|session/i.test(msg)) clients.reset();
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

  // ---------- eios.kantiana.ru (Moodle) ----------

  server.tool(
    "list_courses",
    "Enrolled courses on eios.kantiana.ru (Moodle) with progress.",
    { site },
    safe(async ({ site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      const courses = await m.courses();
      return json(
        courses.map((c) => ({ id: c.id, name: c.fullname, shortname: c.shortname, progress: c.progress, lastaccess: formatDate(c.lastaccess) })),
      );
    }),
  );

  server.tool(
    "get_course_contents",
    "Sections, activities and files of a course. File URLs can be passed to download_file.",
    { course_id: z.number().int(), site },
    safe(async ({ course_id, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return text(summarizeContents(await m.courseContents(course_id)));
    }),
  );

  server.tool(
    "download_file",
    "Download a course file (pluginfile.php URL from get_course_contents). Text is returned inline, other files as base64 resources (max 5 MB).",
    { url: z.string().url(), site },
    safe(async ({ url, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      if (new URL(url).origin !== new URL(m.baseUrl).origin) throw new Error(`URL must be on ${m.baseUrl}`);
      const res = await m.download(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_INLINE_BYTES) throw new Error(`File is ${Math.round(buf.byteLength / 1024 / 1024)} MB; too large to return inline.`);
      if (mime.startsWith("text/") || mime === "application/json") return text(new TextDecoder().decode(buf));
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { content: [{ type: "resource" as const, resource: { uri: url, mimeType: mime, blob: btoa(bin) } }] } as unknown as ReturnType<typeof text>;
    }),
  );

  server.tool(
    "get_assignments",
    "Assignments with due dates (all courses, or one course).",
    { course_id: z.number().int().optional(), site },
    safe(async ({ course_id, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      const res = await m.assignments(course_id ? [course_id] : []);
      return json(
        res.courses.flatMap((c) =>
          c.assignments.map((a) => ({
            assign_id: a.id,
            cmid: a.cmid,
            course: c.fullname,
            name: a.name,
            due: formatDate(a.duedate),
            cutoff: formatDate(a.cutoffdate),
            intro: stripHtml(a.intro).slice(0, 1000),
            attachments: a.introattachments?.map((f) => ({ name: f.filename, url: f.fileurl })),
          })),
        ),
      );
    }),
  );

  server.tool(
    "get_submission_status",
    "Your submission status, feedback and grade for an assignment.",
    { assign_id: z.number().int(), site },
    safe(async ({ assign_id, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.submissionStatus(assign_id));
    }),
  );

  server.tool(
    "submit_assignment",
    "Save an online-text and/or file submission for an assignment, optionally submitting it for grading. Files are given as base64.",
    {
      assign_id: z.number().int(),
      text: z.string().optional().describe("Online text (HTML allowed)"),
      files: z.array(z.object({ filename: z.string(), base64: z.string() })).optional(),
      submit_for_grading: z.boolean().default(false).describe("Finalize the submission (cannot be edited afterwards)"),
      site,
    },
    safe(async ({ assign_id, text: body, files, submit_for_grading, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      if (!body && !files?.length) throw new Error("Provide text and/or files.");
      let itemid: number | undefined;
      for (const f of files ?? []) {
        const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
        itemid = await m.uploadFile(f.filename, bytes, itemid ?? 0);
      }
      const saved = await m.saveSubmission(assign_id, { text: body, fileItemId: itemid });
      const submitted = submit_for_grading ? await m.submitForGrading(assign_id) : undefined;
      return json({ saved, submitted });
    }),
  );

  server.tool(
    "get_grades",
    "Grades: overview across all courses, or the detailed grade report of one course.",
    { course_id: z.number().int().optional(), site },
    safe(async ({ course_id, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      if (course_id) return json(await m.courseGrades(course_id));
      const [overview, courses] = await Promise.all([m.gradesOverview(), m.courses()]);
      const names = new Map(courses.map((c) => [c.id, c.fullname]));
      return json(overview.grades.map((g) => ({ course_id: g.courseid, course: names.get(g.courseid), grade: g.grade, rank: g.rank })));
    }),
  );

  server.tool(
    "get_deadlines",
    "Upcoming deadlines and actionable events (assignments, quizzes, ...) from the Moodle timeline.",
    { days: z.number().int().min(1).max(365).default(30), site },
    safe(async ({ days, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      const now = Math.floor(Date.now() / 1000);
      const { events } = await m.actionEvents({ from: now, to: now + days * 86400, limit: 50 });
      if (events.length === 0) return text(`No deadlines in the next ${days} days.`);
      return text(
        events
          .map((e) => `${formatDate(e.timesort ?? e.timestart)}  ${e.name}${e.course ? ` — ${e.course.fullname}` : ""}${e.action?.actionable ? ` [${e.action.name}]` : ""}${e.url ? `\n    ${e.url}` : ""}`)
          .join("\n"),
      );
    }),
  );

  server.tool(
    "get_calendar",
    "Moodle calendar: upcoming events, or a whole month.",
    { year: z.number().int().optional(), month: z.number().int().min(1).max(12).optional(), site },
    safe(async ({ year, month, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      if (year && month) return json(await m.monthEvents(year, month));
      const { events } = await m.upcomingEvents();
      return json(events.map((e) => ({ id: e.id, name: e.name, type: e.eventtype, start: formatDate(e.timestart), course: e.course?.fullname, url: e.url })));
    }),
  );

  server.tool(
    "get_conversations",
    "Moodle message conversations (private, group and self).",
    { limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0), site },
    safe(async ({ limit, offset, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.conversations(limit, offset));
    }),
  );

  server.tool(
    "get_messages",
    "Messages of a conversation.",
    { conversation_id: z.number().int(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0), site },
    safe(async ({ conversation_id, limit, offset, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.conversationMessages(conversation_id, limit, offset));
    }),
  );

  server.tool(
    "send_message",
    "Send a private Moodle message to a user.",
    { to_user_id: z.number().int(), text: z.string().min(1), site },
    safe(async ({ to_user_id, text: body, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.sendMessage(to_user_id, body));
    }),
  );

  server.tool(
    "get_notifications",
    "Moodle notifications (grading, forum posts, system messages).",
    { limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0), site },
    safe(async ({ limit, offset, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.notifications(limit, offset));
    }),
  );

  server.tool(
    "get_forum_discussions",
    "Discussions of a forum (forum instance id from get_course_contents).",
    { forum_id: z.number().int(), page: z.number().int().min(0).default(0), site },
    safe(async ({ forum_id, page, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.forumDiscussions(forum_id, page));
    }),
  );

  server.tool(
    "get_discussion_posts",
    "Posts of a forum discussion.",
    { discussion_id: z.number().int(), site },
    safe(async ({ discussion_id, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.discussionPosts(discussion_id));
    }),
  );

  server.tool(
    "get_quizzes",
    "Quizzes in your courses, or your attempts for one quiz.",
    { course_id: z.number().int().optional(), quiz_id: z.number().int().optional(), site },
    safe(async ({ course_id, quiz_id, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      if (quiz_id) return json(await m.quizAttempts(quiz_id));
      return json(await m.quizzes(course_id ? [course_id] : []));
    }),
  );

  server.tool(
    "mark_activity_complete",
    "Manually mark a course activity (cmid) as complete or incomplete.",
    { cmid: z.number().int(), completed: z.boolean().default(true), site },
    safe(async ({ cmid, completed, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.markModuleComplete(cmid, completed));
    }),
  );

  server.tool(
    "moodle_call",
    "Call any Moodle web-service function directly (about 440 are available on eios, e.g. core_course_get_courses_by_field, mod_assign_get_grades, mod_workshop_*, core_completion_*). Arguments are a JSON object; arrays and nested objects are supported.",
    {
      function: z.string().regex(/^[a-z0-9_]+$/).describe("wsfunction name"),
      args: z.record(z.unknown()).default({}),
      site,
    },
    safe(async ({ function: fn, args, site }) => {
      const m = site === "lms" ? await clients.lms() : await clients.eios();
      return json(await m.call(fn, args as MoodleArgs));
    }),
  );
}
