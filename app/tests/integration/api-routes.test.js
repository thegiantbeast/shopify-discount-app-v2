import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../utils/logger.server.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock DB
vi.mock("../../db.server", () => ({
  default: {
    liveDiscount: { findMany: vi.fn() },
    discount: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    shop: { findUnique: vi.fn() },
  },
}));

// Mock tier manager
vi.mock("../../utils/tier-manager.server.js", () => ({
  getShopTierInfo: vi.fn().mockResolvedValue({ tier: "FREE" }),
}));

// Mock auth
vi.mock("../../utils/storefront-auth.server.js", () => ({
  authenticateStorefrontRequest: vi.fn().mockResolvedValue(true),
  isStorefrontAuthEnforced: vi.fn().mockReturnValue(false),
}));

// Mock rate limiter
vi.mock("../../utils/rate-limiter.server.js", () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    allowed: true,
    remaining: 59,
    limit: 60,
    retryAfter: null,
  }),
  getRateLimitHeaders: vi.fn().mockReturnValue({}),
  createRateLimitResponse: vi.fn(),
}));

// Mock CORS
vi.mock("../../utils/cors.server.js", () => ({
  getCorsHeaders: vi.fn().mockReturnValue({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  }),
  createCorsPreflightResponse: vi
    .fn()
    .mockReturnValue(new Response(null, { status: 200 })),
}));

// Import route modules AFTER mocks
import {
  loader as discountsLoader,
  action as discountsAction,
} from "../../routes/api.discounts.jsx";
import {
  loader as bestDiscountsLoader,
  action as bestDiscountsAction,
} from "../../routes/api.best-discounts.jsx";
import { getShopTierInfo } from "../../utils/tier-manager.server.js";
import prisma from "../../db.server";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthEnforced,
} from "../../utils/storefront-auth.server.js";
import {
  checkRateLimit,
  getRateLimitHeaders,
  createRateLimitResponse,
} from "../../utils/rate-limiter.server.js";
import {
  getCorsHeaders,
  createCorsPreflightResponse,
} from "../../utils/cors.server.js";

describe("API Routes - Integration Tests", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Reset default mock implementations
    authenticateStorefrontRequest.mockResolvedValue(true);
    isStorefrontAuthEnforced.mockReturnValue(false);
    checkRateLimit.mockReturnValue({
      allowed: true,
      remaining: 59,
      limit: 60,
      retryAfter: null,
    });
    getCorsHeaders.mockReturnValue({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      Vary: "Origin",
    });
    getRateLimitHeaders.mockReturnValue({});
    getShopTierInfo.mockResolvedValue({ tier: "FREE" });
  });

  describe("GET /api/discounts", () => {
    it("should return 400 when shop parameter is missing", async () => {
      const request = new Request("http://localhost/api/discounts");
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing shop parameter");
    });

    it("should return empty products when no filters provided", async () => {
      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.products).toEqual({});
    });

    it("should return matching discounts for valid productIds request", async () => {
      // Setup mock data
      const mockLiveDiscount = {
        id: "ld-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        shopId: "shop-1",
        status: "LIVE",
        summary: "20% off",
        discountType: "AUTO",
        startsAt: new Date("2024-01-01"),
        endsAt: null,
        exclusionReason: null,
        exclusionDetails: null,
      };

      const mockDetailedDiscount = {
        id: "d-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        discountType: "AUTO",
        valueType: "PERCENTAGE",
        percentage: 0.2,
        amount: null,
        currencyCode: null,
        endsAt: null,
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        minimumRequirement: null,
        targets: [
          {
            targetType: "PRODUCT",
            targetGid: "gid://shopify/Product/111",
          },
        ],
        products: [{ productGid: "gid://shopify/Product/111" }],
        variants: [],
        codes: [],
      };

      const mockProduct = {
        gid: "gid://shopify/Product/111",
        handle: "test-product",
        singlePrice: false,
      };

      prisma.liveDiscount.findMany.mockResolvedValue([mockLiveDiscount]);
      prisma.discount.findMany.mockResolvedValue([mockDetailedDiscount]);
      prisma.product.findMany.mockResolvedValue([mockProduct]);

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.products["111"]).toBeDefined();
      expect(data.products["111"].discounts).toHaveLength(1);
      expect(data.products["111"].discounts[0].type).toBe("percentage");
      expect(data.products["111"].discounts[0].value).toBe(20); // 0.2 * 100
      expect(data.products["111"].discounts[0].isAutomatic).toBe(true);
      expect(data.products["111"].handle).toBe("test-product");
      expect(data.autoApplyEnabled).toBe(false); // FREE tier
    });

    it("should return 429 when rate limit is exceeded", async () => {
      checkRateLimit.mockReturnValue({
        allowed: false,
        remaining: 0,
        limit: 60,
        retryAfter: 30,
      });
      createRateLimitResponse.mockReturnValue(
        new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
        })
      );

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });

      expect(createRateLimitResponse).toHaveBeenCalled();
      expect(response.status).toBe(429);
    });

    it("should return 403 when auth is enforced and token is invalid", async () => {
      authenticateStorefrontRequest.mockResolvedValue(false);
      isStorefrontAuthEnforced.mockReturnValue(true);

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Unauthorized");
    });

    it("should allow through when auth is in soft mode and token is invalid", async () => {
      authenticateStorefrontRequest.mockResolvedValue(false);
      isStorefrontAuthEnforced.mockReturnValue(false);
      prisma.liveDiscount.findMany.mockResolvedValue([]);

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });

      expect(response.status).toBe(200);
    });

    it("should exclude fixed-amount discounts for FREE tier", async () => {
      const mockLiveDiscount = {
        id: "ld-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        shopId: "shop-1",
        status: "LIVE",
        summary: "$5 off",
        discountType: "AUTO",
        startsAt: new Date("2024-01-01"),
        endsAt: null,
        exclusionReason: null,
        exclusionDetails: null,
      };

      const mockDetailedDiscount = {
        id: "d-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        discountType: "AUTO",
        valueType: "AMOUNT",
        percentage: null,
        amount: 500,
        currencyCode: "USD",
        endsAt: null,
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        minimumRequirement: null,
        targets: [
          {
            targetType: "PRODUCT",
            targetGid: "gid://shopify/Product/111",
          },
        ],
        products: [{ productGid: "gid://shopify/Product/111" }],
        variants: [],
        codes: [],
      };

      prisma.liveDiscount.findMany.mockResolvedValue([mockLiveDiscount]);
      prisma.discount.findMany.mockResolvedValue([mockDetailedDiscount]);
      prisma.product.findMany.mockResolvedValue([
        {
          gid: "gid://shopify/Product/111",
          handle: "test-product",
          singlePrice: false,
        },
      ]);
      getShopTierInfo.mockResolvedValue({ tier: "FREE" });

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      // Fixed-amount discount should be excluded, so no product entry is created
      expect(data.products["111"]).toBeUndefined();
    });

    it("should handle OPTIONS request with preflight response", async () => {
      const request = new Request("http://localhost/api/discounts", {
        method: "OPTIONS",
      });
      const response = await discountsAction({ request });

      expect(createCorsPreflightResponse).toHaveBeenCalledWith(request, [
        "GET",
        "OPTIONS",
      ]);
      expect(response.status).toBe(200);
    });

    it("should return 405 for POST request", async () => {
      const request = new Request("http://localhost/api/discounts", {
        method: "POST",
      });
      const response = await discountsAction({ request });

      expect(response.status).toBe(405);
      expect(await response.text()).toBe("Method not allowed");
    });

    it("should include BASIC tier autoApplyEnabled flag", async () => {
      getShopTierInfo.mockResolvedValue({ tier: "BASIC" });
      prisma.liveDiscount.findMany.mockResolvedValue([]);

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.autoApplyEnabled).toBe(true); // BASIC tier has autoApplyEnabled: true
    });

    it("should parse multiple comma-separated productIds", async () => {
      prisma.liveDiscount.findMany.mockResolvedValue([]);

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111,222,333"
      );
      const response = await discountsLoader({ request });

      expect(response.status).toBe(200);
      // Verify the query was made (even if empty results)
      expect(prisma.liveDiscount.findMany).toHaveBeenCalled();
    });

    it("should handle variantIds filtering", async () => {
      const mockLiveDiscount = {
        id: "ld-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        shopId: "shop-1",
        status: "LIVE",
        summary: "20% off",
        discountType: "AUTO",
        startsAt: new Date("2024-01-01"),
        endsAt: null,
        exclusionReason: null,
        exclusionDetails: null,
      };

      const mockDetailedDiscount = {
        id: "d-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        discountType: "AUTO",
        valueType: "PERCENTAGE",
        percentage: 0.2,
        amount: null,
        currencyCode: null,
        endsAt: null,
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        minimumRequirement: null,
        targets: [
          {
            targetType: "PRODUCT_VARIANT",
            targetGid: "gid://shopify/ProductVariant/999",
          },
        ],
        products: [{ productGid: "gid://shopify/Product/111" }],
        variants: [{ variantGid: "gid://shopify/ProductVariant/999" }],
        codes: [],
      };

      prisma.liveDiscount.findMany.mockResolvedValue([mockLiveDiscount]);
      prisma.discount.findMany.mockResolvedValue([mockDetailedDiscount]);
      prisma.product.findMany.mockResolvedValue([
        {
          gid: "gid://shopify/Product/111",
          handle: "test-product",
          singlePrice: false,
        },
      ]);
      // Need ADVANCED tier to see PARTIAL variant scope discounts
      getShopTierInfo.mockResolvedValue({ tier: "ADVANCED" });

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&variantIds=999"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.products["111"]).toBeDefined();
      expect(data.products["111"].discounts[0].variantScope.type).toBe(
        "PARTIAL"
      );
    });

    it("should skip discounts with minimum requirements", async () => {
      const mockLiveDiscount = {
        id: "ld-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        shopId: "shop-1",
        status: "LIVE",
        summary: "20% off",
        discountType: "AUTO",
        startsAt: new Date("2024-01-01"),
        endsAt: null,
        exclusionReason: null,
        exclusionDetails: null,
      };

      const mockDetailedDiscount = {
        id: "d-1",
        gid: "gid://shopify/DiscountAutomaticNode/123",
        shop: "test.myshopify.com",
        discountType: "AUTO",
        valueType: "PERCENTAGE",
        percentage: 0.2,
        amount: null,
        currencyCode: null,
        endsAt: null,
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        minimumRequirement: "MINIMUM_PURCHASE_AMOUNT",
        targets: [
          {
            targetType: "PRODUCT",
            targetGid: "gid://shopify/Product/111",
          },
        ],
        products: [{ productGid: "gid://shopify/Product/111" }],
        variants: [],
        codes: [],
      };

      prisma.liveDiscount.findMany.mockResolvedValue([mockLiveDiscount]);
      prisma.discount.findMany.mockResolvedValue([mockDetailedDiscount]);
      prisma.product.findMany.mockResolvedValue([
        {
          gid: "gid://shopify/Product/111",
          handle: "test-product",
          singlePrice: false,
        },
      ]);

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      // Discount with minimum requirement should be excluded, so no product entry is created
      expect(data.products["111"]).toBeUndefined();
    });

    it("should include coupon code for CODE-type discounts", async () => {
      const mockLiveDiscount = {
        id: "ld-1",
        gid: "gid://shopify/DiscountCodeNode/123",
        shop: "test.myshopify.com",
        shopId: "shop-1",
        status: "LIVE",
        summary: "20% off with SAVE20",
        discountType: "CODE",
        startsAt: new Date("2024-01-01"),
        endsAt: null,
        exclusionReason: null,
        exclusionDetails: null,
      };

      const mockDetailedDiscount = {
        id: "d-1",
        gid: "gid://shopify/DiscountCodeNode/123",
        shop: "test.myshopify.com",
        discountType: "CODE",
        valueType: "PERCENTAGE",
        percentage: 0.2,
        amount: null,
        currencyCode: null,
        endsAt: null,
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        minimumRequirement: null,
        targets: [
          {
            targetType: "PRODUCT",
            targetGid: "gid://shopify/Product/111",
          },
        ],
        products: [{ productGid: "gid://shopify/Product/111" }],
        variants: [],
        codes: [{ code: "SAVE20" }],
      };

      prisma.liveDiscount.findMany.mockResolvedValue([mockLiveDiscount]);
      prisma.discount.findMany.mockResolvedValue([mockDetailedDiscount]);
      prisma.product.findMany.mockResolvedValue([
        {
          gid: "gid://shopify/Product/111",
          handle: "test-product",
          singlePrice: false,
        },
      ]);

      const request = new Request(
        "http://localhost/api/discounts?shop=test.myshopify.com&productIds=111"
      );
      const response = await discountsLoader({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.products["111"].discounts[0].isAutomatic).toBe(false);
      expect(data.products["111"].discounts[0].code).toBe("SAVE20");
    });
  });

  describe("POST /api/best-discounts", () => {
    it("should resolve best discounts for valid request", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        token: "abc",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [
              {
                type: "percentage",
                value: 20,
                isAutomatic: true,
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].productId).toBe("111");
      expect(data.results[0].bestDiscounts.automaticDiscount).toBeDefined();
      expect(data.results[0].bestDiscounts.automaticDiscount.value).toBe(20);
      expect(data.results[0].bestDiscounts.automaticEntry.finalPriceCents).toBe(
        8000
      );
    });

    it("should return 400 for invalid JSON body", async () => {
      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{",
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request body");
    });

    it("should return 400 for empty requests array", async () => {
      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [] }),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("requests must be a non-empty array");
    });

    it("should add error for entry missing productId", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            regularPriceCents: 10000,
            discounts: [],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].error).toBe("productId is required");
    });

    it("should add error for non-finite regularPriceCents", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            regularPriceCents: NaN,
            discounts: [],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].error).toBe(
        "regularPriceCents must be a finite number"
      );
    });

    it("should filter discounts by purchase context (subscription)", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            purchaseContext: "subscription",
            discounts: [
              {
                type: "percentage",
                value: 30,
                isAutomatic: true,
                appliesOnSubscription: true,
                appliesOnOneTimePurchase: false,
              },
              {
                type: "percentage",
                value: 20,
                isAutomatic: true,
                appliesOnSubscription: false,
                appliesOnOneTimePurchase: true,
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      // Only the subscription discount should be applied
      expect(data.results[0].bestDiscounts.automaticDiscount.value).toBe(30);
      expect(
        data.results[0].bestDiscounts.automaticEntry.finalPriceCents
      ).toBe(7000);
    });

    it("should suppress coupon when automatic is better", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [
              {
                type: "percentage",
                value: 30,
                isAutomatic: true,
              },
              {
                type: "percentage",
                value: 20,
                isAutomatic: false,
                code: "SAVE20",
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      // Automatic discount should be returned
      expect(data.results[0].bestDiscounts.automaticDiscount.value).toBe(30);
      // Coupon should be suppressed
      expect(data.results[0].bestDiscounts.couponDiscount).toBeNull();
      expect(data.results[0].bestDiscounts.couponEntry).toBeNull();
    });

    it("should return 405 for GET request", async () => {
      const request = new Request("http://localhost/api/best-discounts", {
        method: "GET",
      });

      const response = await bestDiscountsLoader({ request });

      expect(response.status).toBe(405);
      expect(await response.text()).toBe("Method not allowed");
    });

    it("should handle OPTIONS request with preflight response", async () => {
      const request = new Request("http://localhost/api/best-discounts", {
        method: "OPTIONS",
      });

      const response = await bestDiscountsAction({ request });

      expect(createCorsPreflightResponse).toHaveBeenCalledWith(request, [
        "POST",
        "OPTIONS",
      ]);
      expect(response.status).toBe(200);
    });

    it("should return 403 when auth is enforced and invalid", async () => {
      authenticateStorefrontRequest.mockResolvedValue(false);
      isStorefrontAuthEnforced.mockReturnValue(true);

      const requestBody = {
        shop: "test.myshopify.com",
        token: "invalid",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Unauthorized");
    });

    it("should allow through when auth is in soft mode", async () => {
      authenticateStorefrontRequest.mockResolvedValue(false);
      isStorefrontAuthEnforced.mockReturnValue(false);

      const requestBody = {
        shop: "test.myshopify.com",
        token: "invalid",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });

      expect(response.status).toBe(200);
    });

    it("should return null discounts when no discounts provided", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].bestDiscounts.automaticDiscount).toBeNull();
      expect(data.results[0].bestDiscounts.couponDiscount).toBeNull();
    });

    it("should handle multiple requests in batch", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [
              {
                type: "percentage",
                value: 20,
                isAutomatic: true,
              },
            ],
          },
          {
            productId: "222",
            regularPriceCents: 20000,
            discounts: [
              {
                type: "percentage",
                value: 30,
                isAutomatic: false,
                code: "SAVE30",
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(2);
      expect(data.results[0].productId).toBe("111");
      expect(data.results[1].productId).toBe("222");
      expect(data.results[0].bestDiscounts.automaticDiscount.value).toBe(20);
      expect(data.results[1].bestDiscounts.couponDiscount.value).toBe(30);
    });

    it("should include entryVariantId in response", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            variantId: "999",
            regularPriceCents: 10000,
            discounts: [
              {
                type: "percentage",
                value: 20,
                isAutomatic: true,
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].bestDiscounts.entryVariantId).toBe("999");
      expect(data.results[0].variantId).toBe("999");
    });

    it("should normalize discount type to lowercase", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [
              {
                type: "PERCENTAGE",
                value: 20,
                isAutomatic: true,
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].bestDiscounts.automaticDiscount.type).toBe(
        "percentage"
      );
    });

    it("should add error when all discounts have invalid type", async () => {
      const requestBody = {
        shop: "test.myshopify.com",
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [
              {
                type: "invalid_type",
                value: 20,
                isAutomatic: true,
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      // Invalid types are filtered out during normalization, resulting in error
      expect(response.status).toBe(400);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].error).toBe("No valid discounts after normalization");
    });

    it("should work without shop parameter (for anonymous requests)", async () => {
      const requestBody = {
        requests: [
          {
            productId: "111",
            regularPriceCents: 10000,
            discounts: [
              {
                type: "percentage",
                value: 20,
                isAutomatic: true,
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost/api/best-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await bestDiscountsAction({ request });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(data.shop).toBeNull();
    });
  });
});
