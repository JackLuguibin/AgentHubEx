import pino from "pino";

export const logRedact = {
  paths: [
    "password",
    "secret",
    "token",
    "authorization",
    "authSecret",
    "ciphertext",
    "dek",
    "*.password",
    "*.secret",
    "*.token",
    "*.authorization",
    "*.authSecret",
    "*.ciphertext",
    "*.dek",
    "req.headers.authorization",
  ],
  censor: "[REDACTED]",
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "hub-api" },
  redact: logRedact,
});
