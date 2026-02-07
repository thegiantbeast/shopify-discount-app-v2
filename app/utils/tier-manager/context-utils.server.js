import { createLogger } from "../logger.server.js";

const logger = createLogger("TierManager");

export function normalizeDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      return value;
    }
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

export function sanitizeContext(context) {
  if (context === undefined) return undefined;
  try {
    const replacer = (_key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    };
    return JSON.parse(JSON.stringify(context, replacer));
  } catch (error) {
    logger.warn("Failed to sanitize plan change context", {
      error: error?.message ?? String(error),
    });
    return undefined;
  }
}

export function serializeContext(context) {
  if (context === undefined) return undefined;
  if (context === null) return null;
  try {
    return JSON.stringify(context);
  } catch (error) {
    logger.warn("Failed to serialize plan change context", {
      error: error?.message ?? String(error),
    });
    return null;
  }
}

export function parseContext(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseNumeric(value) {
  if (value === null || value === undefined) return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

export function parseDateValue(value) {
  return normalizeDateInput(value);
}
