import { type CockpitDocument } from "../cockpitApi";

function timestampToken(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

export function buildNewCockpitDocument(now = new Date()): CockpitDocument {
  const id = `cockpit-${timestampToken(now)}`;
  return {
    id,
    title: `Cockpit ${now.toLocaleString()}`,
    cwd: `.wt/${id}`,
    taskId: null,
    member: null,
  };
}

export function filterCockpits(rows: CockpitDocument[], query: string): CockpitDocument[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return rows;
  }
  return rows.filter((row) =>
    [row.id, row.title, row.cwd, row.taskId ?? "", row.member ?? ""].some((value) => value.toLowerCase().includes(needle)),
  );
}
