/** Minimal structured (JSON-lines) logger for the worker and CLI. */
type Level = "debug" | "info" | "warn" | "error";

const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
};

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => process.env.LOG_LEVEL === "debug" && emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
