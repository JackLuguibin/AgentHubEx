import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { AppError } from "../errors.js";
import type { AppEnv } from "../context.js";
import { logger } from "../lib/logger.js";

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          requestId,
          details: err.details,
          fieldErrors: err.fieldErrors,
        },
      },
      err.status as 400,
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Validation failed",
          requestId,
          fieldErrors: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      },
      400,
    );
  }

  logger.error({ err, requestId }, "unhandled error");
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: "Internal server error",
        requestId,
      },
    },
    500,
  );
};
