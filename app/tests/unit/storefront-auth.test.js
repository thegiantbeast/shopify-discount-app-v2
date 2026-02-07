import {
  generateStorefrontToken,
  clearTokenCache,
  clearAllTokenCache,
  authenticateStorefrontRequest,
  isStorefrontAuthEnforced,
} from "../../utils/storefront-auth.server.js";

// Mock the logger
vi.mock("../../utils/logger.server.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * Creates a mock database instance for testing
 * @param {string|null} storefrontToken - The token to return, or null for shop not found
 * @returns {Object} Mock Prisma client
 */
function createMockDb(storefrontToken) {
  return {
    shop: {
      findUnique: vi.fn().mockResolvedValue(
        storefrontToken ? { storefrontToken } : null
      ),
    },
  };
}

describe("storefront-auth", () => {
  beforeEach(() => {
    // Reset cache between tests
    clearAllTokenCache();
    // Reset environment variable
    delete process.env.STOREFRONT_AUTH_ENFORCE;
  });

  describe("generateStorefrontToken", () => {
    it("returns a 64-character string", () => {
      const token = generateStorefrontToken();
      expect(token).toHaveLength(64);
    });

    it("returns hex characters only", () => {
      const token = generateStorefrontToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it("generates different tokens on each call", () => {
      const token1 = generateStorefrontToken();
      const token2 = generateStorefrontToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("authenticateStorefrontRequest", () => {
    const validToken = "a".repeat(64);
    const invalidToken = "b".repeat(64);
    const testShop = "test-shop.myshopify.com";

    it("returns true for valid token (DB lookup, caches result)", async () => {
      const db = createMockDb(validToken);

      const result = await authenticateStorefrontRequest(testShop, validToken, db);

      expect(result).toBe(true);
      expect(db.shop.findUnique).toHaveBeenCalledOnce();
      expect(db.shop.findUnique).toHaveBeenCalledWith({
        where: { domain: testShop },
        select: { storefrontToken: true },
      });
    });

    it("returns false for invalid token", async () => {
      const db = createMockDb(validToken);

      const result = await authenticateStorefrontRequest(testShop, invalidToken, db);

      expect(result).toBe(false);
    });

    it("returns false for different length token", async () => {
      const db = createMockDb(validToken);
      const shortToken = "a".repeat(32); // Different length

      const result = await authenticateStorefrontRequest(testShop, shortToken, db);

      expect(result).toBe(false);
    });

    it("returns false for empty token", async () => {
      const db = createMockDb(validToken);

      const result = await authenticateStorefrontRequest(testShop, "", db);

      expect(result).toBe(false);
    });

    it("returns false for non-string token", async () => {
      const db = createMockDb(validToken);

      const result1 = await authenticateStorefrontRequest(testShop, null, db);
      const result2 = await authenticateStorefrontRequest(testShop, undefined, db);
      const result3 = await authenticateStorefrontRequest(testShop, 123, db);

      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    it("returns false for null shop", async () => {
      const db = createMockDb(validToken);

      const result = await authenticateStorefrontRequest(null, validToken, db);

      expect(result).toBe(false);
      expect(db.shop.findUnique).not.toHaveBeenCalled();
    });

    it("returns false when shop not in DB", async () => {
      const db = createMockDb(null); // Shop not found

      const result = await authenticateStorefrontRequest(testShop, validToken, db);

      expect(result).toBe(false);
      expect(db.shop.findUnique).toHaveBeenCalledOnce();
    });

    it("caches token on first call, uses cache on second call", async () => {
      const db = createMockDb(validToken);

      // First call - should query DB
      const result1 = await authenticateStorefrontRequest(testShop, validToken, db);
      expect(result1).toBe(true);
      expect(db.shop.findUnique).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await authenticateStorefrontRequest(testShop, validToken, db);
      expect(result2).toBe(true);
      expect(db.shop.findUnique).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it("clearTokenCache removes specific shop", async () => {
      const db = createMockDb(validToken);

      // First call - caches token
      await authenticateStorefrontRequest(testShop, validToken, db);
      expect(db.shop.findUnique).toHaveBeenCalledTimes(1);

      // Clear cache for this shop
      clearTokenCache(testShop);

      // Next call should query DB again
      await authenticateStorefrontRequest(testShop, validToken, db);
      expect(db.shop.findUnique).toHaveBeenCalledTimes(2);
    });

    it("clearAllTokenCache removes all", async () => {
      const db1 = createMockDb(validToken);
      const db2 = createMockDb(validToken);
      const shop1 = "shop1.myshopify.com";
      const shop2 = "shop2.myshopify.com";

      // Cache tokens for two shops
      await authenticateStorefrontRequest(shop1, validToken, db1);
      await authenticateStorefrontRequest(shop2, validToken, db2);
      expect(db1.shop.findUnique).toHaveBeenCalledTimes(1);
      expect(db2.shop.findUnique).toHaveBeenCalledTimes(1);

      // Clear all cache
      clearAllTokenCache();

      // Both shops should query DB again
      await authenticateStorefrontRequest(shop1, validToken, db1);
      await authenticateStorefrontRequest(shop2, validToken, db2);
      expect(db1.shop.findUnique).toHaveBeenCalledTimes(2);
      expect(db2.shop.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe("isStorefrontAuthEnforced", () => {
    it("returns true when STOREFRONT_AUTH_ENFORCE='true'", () => {
      process.env.STOREFRONT_AUTH_ENFORCE = "true";
      expect(isStorefrontAuthEnforced()).toBe(true);
    });

    it("returns false when STOREFRONT_AUTH_ENFORCE='false'", () => {
      process.env.STOREFRONT_AUTH_ENFORCE = "false";
      expect(isStorefrontAuthEnforced()).toBe(false);
    });

    it("returns false when STOREFRONT_AUTH_ENFORCE is not set", () => {
      delete process.env.STOREFRONT_AUTH_ENFORCE;
      expect(isStorefrontAuthEnforced()).toBe(false);
    });

    it("returns false for other values", () => {
      process.env.STOREFRONT_AUTH_ENFORCE = "1";
      expect(isStorefrontAuthEnforced()).toBe(false);

      process.env.STOREFRONT_AUTH_ENFORCE = "yes";
      expect(isStorefrontAuthEnforced()).toBe(false);
    });
  });
});
