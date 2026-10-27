export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "TOKEN_EXPIRED"
  | "FORBIDDEN"
  | "BLOCKED_UPSTREAM_PATH"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSTANCE_IN_USE"
  | "TENANT_SUSPENDED"
  | "PROJECT_ARCHIVED"
  | "INVALID_TRANSITION"
  | "INVALID_PATH"
  | "PROTECTED_PATH"
  | "QUOTA_EXCEEDED"
  | "PRECONDITION_FAILED"
  | "INTERNAL";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly fieldErrors?: { path: string; message: string }[];

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      fieldErrors?: { path: string; message: string }[];
    },
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.fieldErrors = options?.fieldErrors;
  }
}

export function unauthenticated(message = "Authentication required"): AppError {
  return new AppError(401, "UNAUTHENTICATED", message);
}

export function forbidden(message = "Forbidden"): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found"): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(
  message: string,
  details?: Record<string, unknown>,
  code: ErrorCode = "CONFLICT",
): AppError {
  return new AppError(409, code, message, { details });
}
