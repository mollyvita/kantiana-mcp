# kantiana-mcp

An [MCP](https://modelcontextprotocol.io) server for the BFU Kantiana university systems:

- **lk.kantiana.ru**: profile, schedules (personal, group and teacher), notices, news
- **eios.kantiana.ru** (Moodle, where the courses live): courses, materials and files, assignments and submissions, grades, deadlines, calendar, messages, notifications, forums, quizzes and activity completion, plus `moodle_call`, which calls any of the ~440 Moodle web-service functions directly
- **lms.kantiana.ru**: the same Moodle tools with `site: "lms"`

It runs as a stateless Cloudflare Worker using Streamable HTTP. The API client is [kantiana-api](https://github.com/mollyvita/kantiana-api).

## Tools

| Area | Tools |
| --- | --- |
| LK | `get_profile`, `get_schedule`, `search_groups`, `get_group_schedule`, `search_teachers`, `get_teacher_schedule`, `get_notices`, `dismiss_notice`, `get_news`, `get_services` |
| Courses | `list_courses`, `get_course_contents`, `download_file`, `mark_activity_complete` |
| Assignments | `get_assignments`, `get_submission_status`, `submit_assignment` |
| Progress | `get_grades`, `get_deadlines`, `get_calendar`, `get_quizzes` |
| Communication | `get_conversations`, `get_messages`, `send_message`, `get_notifications`, `get_forum_discussions`, `get_discussion_posts` |
| Escape hatch | `moodle_call` |

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

- Each Worker isolate caches the LK cookies and Moodle token for one hour, so the SSO flow doesn't run on every request. When an error looks like an auth problem, the cache is dropped and the next call logs in again.
- `download_file` only accepts URLs on the selected Moodle host, so the token never leaves it.
