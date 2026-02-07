import { createMockPrisma, createMockShop, createMockDiscountData, MOCK_SHOP_DOMAIN, MOCK_DISCOUNT_GID } from "../fixtures/mock-data.js";

// Mock logger
vi.mock("../../utils/logger.server.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock graphql client
vi.mock("../../utils/discount-resolver/graphql-client.server.js", () => ({
  graphqlQuery: vi.fn(),
}));

// Mock tier-manager
vi.mock("../../utils/tier-manager.server.js", () => ({
  canHaveMoreLiveDiscounts: vi.fn().mockResolvedValue({ canCreate: true }),
  getOrCreateShopTier: vi.fn().mockResolvedValue({ tier: "FREE", liveDiscountLimit: 1 }),
  getEffectiveTierFromShopRecord: vi.fn().mockReturnValue("FREE"),
}));

// Mock store-data (called by resolve-targets)
vi.mock("../../utils/discount-resolver/store-data.server.js", () => ({
  storeCollectionData: vi.fn().mockResolvedValue(undefined),
  storeProductData: vi.fn().mockResolvedValue(undefined),
}));

// Mock fetchers (called by resolve-targets)
vi.mock("../../utils/discount-resolver/fetchers.server.js", () => ({
  fetchCollectionProducts: vi.fn().mockResolvedValue([]),
  fetchVariantProductAndAllVariants: vi.fn().mockResolvedValue({ productId: null, variantIds: [] }),
  fetchAllDiscountCodes: vi.fn().mockResolvedValue([]),
}));

// Import mocked modules for setup
import { canHaveMoreLiveDiscounts, getOrCreateShopTier, getEffectiveTierFromShopRecord } from "../../utils/tier-manager.server.js";
import { fetchCollectionProducts } from "../../utils/discount-resolver/fetchers.server.js";

// Import functions under test
// Signatures:
//   updateLiveDiscountData(discountId, discountData, shop, db, opts)
//   checkAndCleanupExpiredDiscounts(shop, db)
//   resolveDiscountTargets(admin, discountData, shop, db, options)
//   storeDiscountData(discountId, discountData, resolvedData, shop, db)
//   evaluateTierGating(discountData, shop, db)
import { updateLiveDiscountData, EXCLUSION_REASONS } from "../../utils/discount-resolver/live-discount-updater.server.js";
import { checkAndCleanupExpiredDiscounts } from "../../utils/discount-resolver/cleanup.server.js";
import { resolveDiscountTargets } from "../../utils/discount-resolver/resolve-targets.server.js";
import { storeDiscountData } from "../../utils/discount-resolver/discount-storage.server.js";
import { evaluateTierGating } from "../../utils/discount-resolver/tier-gating.server.js";

describe("Webhook Handler Integration Tests", () => {
  let db;
  let mockShop;
  const shop = MOCK_SHOP_DOMAIN;

  beforeEach(() => {
    db = createMockPrisma();
    mockShop = createMockShop();

    vi.clearAllMocks();

    // Default DB responses
    db.shop.findUnique.mockResolvedValue(mockShop);
    db.liveDiscount.findUnique.mockResolvedValue(null);
    db.liveDiscount.findMany.mockResolvedValue([]);
    db.discount.findMany.mockResolvedValue([]);
    db.liveDiscount.upsert.mockResolvedValue({});
    db.liveDiscount.deleteMany.mockResolvedValue({ count: 0 });
    db.discount.deleteMany.mockResolvedValue({ count: 0 });
    db.discount.upsert.mockResolvedValue({ id: "disc-1", gid: MOCK_DISCOUNT_GID });

    // Default tier mocks
    getOrCreateShopTier.mockResolvedValue({ tier: "FREE", liveDiscountLimit: 1 });
    getEffectiveTierFromShopRecord.mockReturnValue("FREE");
    canHaveMoreLiveDiscounts.mockResolvedValue({ canCreate: true });
  });

  describe("Discount Pipeline — updateLiveDiscountData", () => {
    it("should set LIVE status for active product discount", async () => {
      const discountData = createMockDiscountData({ status: "ACTIVE" });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { gid: MOCK_DISCOUNT_GID },
          create: expect.objectContaining({ status: "LIVE" }),
          update: expect.objectContaining({ status: "LIVE" }),
        })
      );
    });

    it("should remove expired discount from both tables", async () => {
      const discountData = createMockDiscountData({ status: "EXPIRED" });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.deleteMany).toHaveBeenCalledWith({
        where: { gid: MOCK_DISCOUNT_GID, shop },
      });
      expect(db.discount.deleteMany).toHaveBeenCalledWith({
        where: { gid: MOCK_DISCOUNT_GID, shop },
      });
    });

    it("should remove past end date discount", async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const discountData = createMockDiscountData({ status: "ACTIVE", endsAt: pastDate });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.deleteMany).toHaveBeenCalled();
      expect(db.discount.deleteMany).toHaveBeenCalled();
    });

    it("should mark non-product discount as NOT_SUPPORTED", async () => {
      const discountData = createMockDiscountData({
        status: "ACTIVE",
        discountClass: "SHIPPING",
        discountClasses: ["SHIPPING"],
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { gid: MOCK_DISCOUNT_GID },
          create: expect.objectContaining({
            status: "NOT_SUPPORTED",
            exclusionReason: EXCLUSION_REASONS.NOT_PRODUCT_DISCOUNT,
          }),
          update: expect.objectContaining({
            status: "NOT_SUPPORTED",
            exclusionReason: EXCLUSION_REASONS.NOT_PRODUCT_DISCOUNT,
          }),
        })
      );
    });

    it("should mark BXGY discount as NOT_SUPPORTED", async () => {
      const discountData = createMockDiscountData({
        __typename: "DiscountAutomaticBxgy",
        status: "ACTIVE",
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: "NOT_SUPPORTED",
            exclusionReason: EXCLUSION_REASONS.BXGY_DISCOUNT,
          }),
        })
      );
    });

    it("should mark customer segment discount as NOT_SUPPORTED", async () => {
      const discountData = createMockDiscountData({
        status: "ACTIVE",
        context: { __typename: "DiscountCustomerSegments" },
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: "NOT_SUPPORTED",
            exclusionReason: EXCLUSION_REASONS.CUSTOMER_SEGMENT,
          }),
        })
      );
    });

    it("should mark minimum requirement discount as NOT_SUPPORTED", async () => {
      const discountData = createMockDiscountData({
        status: "ACTIVE",
        minimumRequirement: { greaterThanOrEqualToSubtotal: { amount: "50" } },
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: "NOT_SUPPORTED",
            exclusionReason: EXCLUSION_REASONS.MIN_REQUIREMENT,
          }),
        })
      );
    });

    it("should mark subscription discount on FREE tier as UPGRADE_REQUIRED", async () => {
      const discountData = createMockDiscountData({
        status: "ACTIVE",
        customerGets: {
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: true,
          items: { products: { nodes: [{ id: "gid://shopify/Product/111" }] } },
          value: { percentage: 0.15 },
        },
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: "UPGRADE_REQUIRED",
            exclusionReason: EXCLUSION_REASONS.SUBSCRIPTION_TIER,
          }),
        })
      );
    });

    it("should mark fixed amount discount on FREE tier as UPGRADE_REQUIRED", async () => {
      const discountData = createMockDiscountData({
        status: "ACTIVE",
        customerGets: {
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: false,
          items: { products: { nodes: [{ id: "gid://shopify/Product/111" }] } },
          value: { amount: { amount: "10.00", currencyCode: "USD" } },
        },
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: "UPGRADE_REQUIRED",
            exclusionReason: EXCLUSION_REASONS.FIXED_AMOUNT_TIER,
          }),
        })
      );
    });

    it("should mark scheduled discount (future start date) as SCHEDULED", async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const discountData = createMockDiscountData({
        status: "ACTIVE",
        startsAt: futureDate,
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db);

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: "SCHEDULED" }),
        })
      );
    });

    it("should preserve existing HIDDEN status with preserveExistingStatus", async () => {
      const discountData = createMockDiscountData({ status: "ACTIVE" });

      db.liveDiscount.findUnique.mockResolvedValue({
        id: "ld-1",
        gid: MOCK_DISCOUNT_GID,
        status: "HIDDEN",
      });

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db, {
        preserveExistingStatus: true,
      });

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: "HIDDEN" }),
        })
      );
    });

    it("should start new discount as HIDDEN with preserveExistingStatus", async () => {
      const discountData = createMockDiscountData({ status: "ACTIVE" });

      db.liveDiscount.findUnique.mockResolvedValue(null);

      await updateLiveDiscountData(MOCK_DISCOUNT_GID, discountData, shop, db, {
        preserveExistingStatus: true,
      });

      expect(db.liveDiscount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: "HIDDEN" }),
        })
      );
    });
  });

  describe("Cleanup Integration", () => {
    it("should cleanup expired discounts from both tables", async () => {
      db.discount.findMany.mockResolvedValue([
        { gid: "gid://shopify/DiscountNode/1" },
        { gid: "gid://shopify/DiscountNode/2" },
      ]);
      db.liveDiscount.findMany.mockResolvedValue([
        { gid: "gid://shopify/DiscountNode/1" },
      ]);

      const result = await checkAndCleanupExpiredDiscounts(shop, db);

      expect(db.discount.deleteMany).toHaveBeenCalledWith({
        where: {
          gid: { in: expect.arrayContaining(["gid://shopify/DiscountNode/1", "gid://shopify/DiscountNode/2"]) },
          shop,
        },
      });
      expect(db.liveDiscount.deleteMany).toHaveBeenCalledWith({
        where: {
          gid: { in: expect.arrayContaining(["gid://shopify/DiscountNode/1", "gid://shopify/DiscountNode/2"]) },
          shop,
        },
      });
    });

    it("should not delete if no expired discounts found", async () => {
      db.discount.findMany.mockResolvedValue([]);
      db.liveDiscount.findMany.mockResolvedValue([]);

      await checkAndCleanupExpiredDiscounts(shop, db);

      expect(db.discount.deleteMany).not.toHaveBeenCalled();
      expect(db.liveDiscount.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("Resolve Targets Integration", () => {
    it("should resolve product-targeted discount correctly", async () => {
      const discountData = createMockDiscountData({
        customerGets: {
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: false,
          items: {
            products: {
              nodes: [
                { id: "gid://shopify/Product/1" },
                { id: "gid://shopify/Product/2" },
              ],
            },
          },
          value: { percentage: 0.2 },
        },
      });

      const mockAdmin = {};
      const result = await resolveDiscountTargets(mockAdmin, discountData, shop, db);

      expect(result).not.toBeNull();
      expect(result.productIds).toContain("gid://shopify/Product/1");
      expect(result.productIds).toContain("gid://shopify/Product/2");
    });

    it("should return null for non-product discount", async () => {
      const discountData = createMockDiscountData({
        discountClass: "SHIPPING",
        discountClasses: ["SHIPPING"],
      });

      const result = await resolveDiscountTargets({}, discountData, shop, db);
      expect(result).toBeNull();
    });

    it("should resolve collection-targeted discount via fetchers", async () => {
      const discountData = createMockDiscountData({
        customerGets: {
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: false,
          items: {
            collections: {
              nodes: [{ id: "gid://shopify/Collection/100" }],
            },
          },
          value: { percentage: 0.2 },
        },
      });

      fetchCollectionProducts.mockResolvedValue([
        "gid://shopify/Product/10",
        "gid://shopify/Product/11",
      ]);

      const result = await resolveDiscountTargets({}, discountData, shop, db);

      expect(result).not.toBeNull();
      expect(result.productIds).toContain("gid://shopify/Product/10");
      expect(result.productIds).toContain("gid://shopify/Product/11");
    });
  });

  describe("Tier Gating Integration", () => {
    it("should gate subscription discount on FREE tier", async () => {
      const discountData = createMockDiscountData({
        customerGets: {
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: true,
          items: { products: { nodes: [{ id: "gid://shopify/Product/111" }] } },
          value: { percentage: 0.2 },
        },
      });

      const result = await evaluateTierGating(discountData, shop, db);

      expect(result.tier).toBe("FREE");
      expect(result.isAdvanced).toBe(false);
      expect(result.appliesOnSubscription).toBe(true);
    });

    it("should allow everything on ADVANCED tier", async () => {
      getOrCreateShopTier.mockResolvedValue({ tier: "ADVANCED", liveDiscountLimit: null });
      getEffectiveTierFromShopRecord.mockReturnValue("ADVANCED");

      const discountData = createMockDiscountData({
        customerGets: {
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: true,
          items: { products: { nodes: [{ id: "gid://shopify/Product/111" }] } },
          value: { percentage: 0.2 },
        },
      });

      const result = await evaluateTierGating(discountData, shop, db);

      expect(result.tier).toBe("ADVANCED");
      expect(result.isAdvanced).toBe(true);
      expect(result.isBasicOrHigher).toBe(true);
    });

    it("should detect variant targets", async () => {
      const discountData = createMockDiscountData({
        customerGets: {
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: false,
          items: {
            productVariants: {
              nodes: [{ id: "gid://shopify/ProductVariant/444" }],
            },
          },
          value: { percentage: 0.2 },
        },
      });

      const result = await evaluateTierGating(discountData, shop, db);

      expect(result.hasVariantTargets).toBe(true);
    });
  });

  describe("Store Discount Data Integration", () => {
    it("should create discount and junction table entries", async () => {
      const discountData = createMockDiscountData({ status: "ACTIVE" });
      const resolvedTargets = {
        productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
        variantIds: [],
      };

      db.discount.upsert.mockResolvedValue({ id: "disc-1", gid: MOCK_DISCOUNT_GID });

      await storeDiscountData(MOCK_DISCOUNT_GID, discountData, resolvedTargets, shop, db);

      expect(db.discount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { gid: MOCK_DISCOUNT_GID },
        })
      );

      expect(db.discountProduct.createMany).toHaveBeenCalledWith({
        data: [
          { discountId: "disc-1", productGid: "gid://shopify/Product/1" },
          { discountId: "disc-1", productGid: "gid://shopify/Product/2" },
        ],
        skipDuplicates: true,
      });
    });

    it("should create variant junction entries", async () => {
      const discountData = createMockDiscountData({ status: "ACTIVE" });
      const resolvedTargets = {
        productIds: [],
        variantIds: ["gid://shopify/ProductVariant/444"],
      };

      db.discount.upsert.mockResolvedValue({ id: "disc-1", gid: MOCK_DISCOUNT_GID });

      await storeDiscountData(MOCK_DISCOUNT_GID, discountData, resolvedTargets, shop, db);

      expect(db.discountVariant.createMany).toHaveBeenCalledWith({
        data: [{ discountId: "disc-1", variantGid: "gid://shopify/ProductVariant/444" }],
        skipDuplicates: true,
      });
    });
  });
});
