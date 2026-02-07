import { PrismaClient } from "@prisma/client";

const SQLITE_PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA cache_size = -64000",
  "PRAGMA foreign_keys = ON",
  "PRAGMA mmap_size = 134217728",
  "PRAGMA journal_size_limit = 67108864",
  "PRAGMA temp_store = MEMORY",
];

const globalAny = global;

async function applyPragmas(client) {
  for (const pragma of SQLITE_PRAGMAS) {
    await client.$executeRawUnsafe(pragma);
  }
}

function createClient() {
  const client = new PrismaClient();
  return client;
}

const resetDevClientIfOutdated = () => {
  const existing = globalAny.prismaGlobal;
  if (!existing) {
    return;
  }

  const delegate = existing.planSubscriptionLog;
  const hasDelegate = delegate && typeof delegate === "object";
  if (!hasDelegate) {
    existing.$disconnect().catch(() => null);
    globalAny.prismaGlobal = undefined;
  }
};

export const getPrismaClient = () => {
  if (process.env.NODE_ENV === "production") {
    if (!globalAny.__prismaProdClient) {
      const client = createClient();
      globalAny.__prismaProdClient = client;
      applyPragmas(client).catch((err) => {
        console.error("FATAL: Failed to apply SQLite PRAGMAs:", err);
        process.exit(1);
      });
    }
    return globalAny.__prismaProdClient;
  }

  resetDevClientIfOutdated();

  if (!globalAny.prismaGlobal) {
    const client = createClient();
    globalAny.prismaGlobal = client;
    applyPragmas(client).catch((err) => {
      console.error("Failed to apply SQLite PRAGMAs in dev:", err);
    });
  }

  return globalAny.prismaGlobal;
};

const prisma = getPrismaClient();

export default prisma;
