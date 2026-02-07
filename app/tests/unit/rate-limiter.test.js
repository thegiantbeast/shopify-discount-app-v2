vi.mock("../../utils/logger.server.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("rate-limiter.server.js", () => {
  let checkRateLimit, getRateLimitHeaders, createRateLimitResponse, resetRateLimit, resetAllRateLimits;

  beforeEach(async () => {
    vi.resetModules();
    const rateLimiterModule = await import("../../utils/rate-limiter.server.js");
    checkRateLimit = rateLimiterModule.checkRateLimit;
    getRateLimitHeaders = rateLimiterModule.getRateLimitHeaders;
    createRateLimitResponse = rateLimiterModule.createRateLimitResponse;
    resetRateLimit = rateLimiterModule.resetRateLimit;
    resetAllRateLimits = rateLimiterModule.resetAllRateLimits;

    resetAllRateLimits();
  });

  describe("checkRateLimit", () => {
    it("should allow first request with remaining = 59", () => {
      const result = checkRateLimit("test-shop.myshopify.com");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59);
      expect(result.retryAfter).toBeNull();
    });

    it("should always allow requests when no shop is provided", () => {
      const result1 = checkRateLimit(null);
      const result2 = checkRateLimit(undefined);
      const result3 = checkRateLimit("");

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
    });

    it("should allow multiple requests within limit and decrement remaining", () => {
      const shop = "test-shop.myshopify.com";

      const result1 = checkRateLimit(shop);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(59);

      const result2 = checkRateLimit(shop);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(58);

      const result3 = checkRateLimit(shop);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(57);
    });

    it("should block request after exceeding limit (60 requests)", () => {
      const shop = "test-shop.myshopify.com";

      for (let i = 0; i < 60; i++) {
        const result = checkRateLimit(shop);
        expect(result.allowed).toBe(true);
      }

      const result61 = checkRateLimit(shop);
      expect(result61.allowed).toBe(false);
      expect(result61.remaining).toBe(0);
      expect(result61.retryAfter).toBeGreaterThan(0);
    });
  });

  describe("getRateLimitHeaders", () => {
    it("should return correct header strings", () => {
      // The actual API: getRateLimitHeaders({ allowed, remaining, retryAfter })
      const result = { allowed: true, remaining: 45, retryAfter: null };
      const headers = getRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("60");
      expect(headers["X-RateLimit-Remaining"]).toBe("45");
    });

    it("should include Retry-After when retryAfter is present", () => {
      const result = { allowed: false, remaining: 0, retryAfter: 30 };
      const headers = getRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("60");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["Retry-After"]).toBe("30");
    });
  });

  describe("createRateLimitResponse", () => {
    it("should return 429 with JSON body and rate limit headers", async () => {
      const result = { allowed: false, remaining: 0, retryAfter: 30 };
      const response = createRateLimitResponse(result);

      expect(response.status).toBe(429);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(response.headers.get("Retry-After")).toBe("30");

      const body = await response.json();
      expect(body.error).toBe("Too Many Requests");
      expect(body.retryAfter).toBe(30);
    });
  });

  describe("resetRateLimit", () => {
    it("should clear rate limit for specific shop", () => {
      const shop = "test-shop.myshopify.com";

      checkRateLimit(shop);
      checkRateLimit(shop);
      checkRateLimit(shop);

      let result = checkRateLimit(shop);
      expect(result.remaining).toBe(56);

      resetRateLimit(shop);

      result = checkRateLimit(shop);
      expect(result.remaining).toBe(59);
    });
  });

  describe("resetAllRateLimits", () => {
    it("should clear all rate limits for all shops", () => {
      const shop1 = "shop1.myshopify.com";
      const shop2 = "shop2.myshopify.com";

      checkRateLimit(shop1);
      checkRateLimit(shop1);
      checkRateLimit(shop2);
      checkRateLimit(shop2);
      checkRateLimit(shop2);

      let result1 = checkRateLimit(shop1);
      let result2 = checkRateLimit(shop2);
      expect(result1.remaining).toBe(57);
      expect(result2.remaining).toBe(56);

      resetAllRateLimits();

      result1 = checkRateLimit(shop1);
      result2 = checkRateLimit(shop2);
      expect(result1.remaining).toBe(59);
      expect(result2.remaining).toBe(59);
    });
  });
});
