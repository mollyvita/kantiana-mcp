import type { LkScheduleDay } from "kantiana-api";

export function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export function json(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

export function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Kaliningrad" });
}

export function formatSchedule(days: LkScheduleDay[]): string {
  const nonEmpty = days.filter((d) => d.classes.length > 0);
  if (nonEmpty.length === 0) return "No classes in this period.";
  return nonEmpty
    .map((d) => {
      const lines = d.classes.map((c) => {
        const sub = c.subgroup && c.subgroup !== "Общая" ? ` [${c.subgroup}]` : "";
        const where = [c.location?.room, c.location?.address].filter(Boolean).join(", ");
        return `  ${c.time.start}–${c.time.end}  ${c.lesson.title} (${c.lesson.type})${sub}\n      ${c.teachers.join(", ")}${where ? ` · ${where}` : ""}`;
      });
      return `${d.date}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
