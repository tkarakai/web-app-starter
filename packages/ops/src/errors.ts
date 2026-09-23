export class OpsError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint: string,
    public exitCode = 1,
    public details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) { super(message, options); this.name = "OpsError"; }
}

const secrets = new Set<string>();
export function registerSecret(value: string) { if (value) secrets.add(value); }
export function redact(value: string): string {
  for (const secret of secrets) value = value.split(secret).join("[REDACTED]");
  return value.replace(/(?:gh[pousr]_[\w]+|github_pat_[\w]+)/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
}
export function errorInfo(error: unknown) {
  const e = error instanceof OpsError ? error : new OpsError(
    "UNEXPECTED", error instanceof Error ? error.message : String(error),
    "Retry with --debug and report the error with the command you ran.", 1,
  );
  return { code: e.code, message: redact(e.message), hint: e.hint, details: JSON.parse(redact(JSON.stringify(e.details))) };
}
export function usage(message: string): never {
  throw new OpsError("USAGE", message, "Run ops --help for usage.", 2);
}
