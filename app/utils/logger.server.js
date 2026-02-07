import pino from "pino";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production"
    ? { transport: { target: "pino-pretty" } }
    : {}),
});

/**
 * Wraps a pino child logger to use (message, data?) signature
 * instead of pino's native (data, message) signature.
 *
 * Supported call styles:
 *   logger.info("message")
 *   logger.info("message", { shop, gid })
 */
function wrapChild(child) {
  const wrap = (level) => (...args) => {
    if (
      typeof args[0] === "string" &&
      args.length > 1 &&
      args[1] != null &&
      typeof args[1] === "object"
    ) {
      return child[level](args[1], args[0]);
    }
    return child[level](...args);
  };

  return {
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    debug: wrap("debug"),
    trace: wrap("trace"),
    fatal: wrap("fatal"),
    child: (opts) => wrapChild(child.child(opts)),
  };
}

const logger = wrapChild(pinoLogger);

export default logger;

export function createLogger(module) {
  return logger.child({ module });
}
