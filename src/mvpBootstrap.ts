export type BootstrapValues = {
  taskId: string;
  member: string;
  cwd: string;
};

const sanitize = (value: string): string => value.trim();

export function buildCockpitSearch(values: BootstrapValues): string {
  const params = new URLSearchParams();
  const taskId = sanitize(values.taskId);
  const member = sanitize(values.member);
  const cwd = sanitize(values.cwd);
  if (taskId) {
    params.set("task_id", taskId);
  }
  if (member) {
    params.set("member", member);
  }
  if (cwd) {
    params.set("cwd", cwd);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
