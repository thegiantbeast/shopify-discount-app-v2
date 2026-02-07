import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("SQLite PRAGMAs", () => {
  let executedPragmas;
  let mockPrismaClient;

  beforeEach(() => {
    // Reset executed PRAGMAs array
    executedPragmas = [];

    // Mock PrismaClient to capture PRAGMA calls
    mockPrismaClient = {
      $executeRawUnsafe: vi.fn((sql) => {
        executedPragmas.push(sql);
        return Promise.resolve();
      }),
      planSubscriptionLog: { findMany: vi.fn() },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock("@prisma/client", () => ({
      PrismaClient: vi.fn(() => mockPrismaClient),
    }));

    vi.doMock("../../utils/logger.server.js", () => ({
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));

    // Clean up globals
    delete global.__prismaProdClient;
    delete global.prismaGlobal;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("should apply all 8 required PRAGMAs with correct values", async () => {
    // Import the db.server module - this triggers client creation and PRAGMA application
    const dbModule = await import("../../db.server.js");
    const prisma = dbModule.default;

    // Wait for async PRAGMA application
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify all 8 PRAGMAs are applied
    expect(executedPragmas).toContain("PRAGMA journal_mode = WAL");
    expect(executedPragmas).toContain("PRAGMA busy_timeout = 5000");
    expect(executedPragmas).toContain("PRAGMA synchronous = NORMAL");
    expect(executedPragmas).toContain("PRAGMA cache_size = -64000");
    expect(executedPragmas).toContain("PRAGMA foreign_keys = ON");
    expect(executedPragmas).toContain("PRAGMA mmap_size = 134217728");
    expect(executedPragmas).toContain("PRAGMA journal_size_limit = 67108864");
    expect(executedPragmas).toContain("PRAGMA temp_store = MEMORY");

    // Verify exactly 8 PRAGMAs (no more, no less)
    expect(executedPragmas).toHaveLength(8);
  });

  it("should have PrismaClient instantiated", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const dbModule = await import("../../db.server.js");
    const prisma = dbModule.default;

    // Verify PrismaClient was instantiated
    expect(PrismaClient).toHaveBeenCalled();
    expect(prisma).toBeDefined();
  });

  it("should apply PRAGMAs in the correct format (no typos)", async () => {
    const dbModule = await import("../../db.server.js");
    const prisma = dbModule.default;

    // Wait for async PRAGMA application
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify exact PRAGMA strings (case-sensitive, spacing-sensitive)
    const expectedPragmas = [
      "PRAGMA journal_mode = WAL",
      "PRAGMA busy_timeout = 5000",
      "PRAGMA synchronous = NORMAL",
      "PRAGMA cache_size = -64000",
      "PRAGMA foreign_keys = ON",
      "PRAGMA mmap_size = 134217728",
      "PRAGMA journal_size_limit = 67108864",
      "PRAGMA temp_store = MEMORY",
    ];

    for (const pragma of expectedPragmas) {
      expect(executedPragmas).toContain(pragma);
    }
  });
});
