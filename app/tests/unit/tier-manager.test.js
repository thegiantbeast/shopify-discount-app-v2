import {
  TIER_CONFIG,
  TIER_KEYS,
  getTierPrice,
  getAvailableTiers,
  getEffectiveTierFromShopRecord,
  isFeatureEnabled,
  getLiveDiscountLimit,
} from "../../utils/tier-manager.js";

describe("tier-manager", () => {
  describe("TIER_CONFIG", () => {
    it("has exactly 3 tiers: FREE, BASIC, ADVANCED", () => {
      const keys = Object.keys(TIER_CONFIG);
      expect(keys).toEqual(["FREE", "BASIC", "ADVANCED"]);
      expect(keys).toHaveLength(3);
    });

    it("each tier has required properties", () => {
      expect(TIER_CONFIG.FREE).toMatchObject({
        name: "Free",
        liveDiscountLimit: 1,
        price: 0,
      });
      expect(TIER_CONFIG.FREE.features).toBeInstanceOf(Array);

      expect(TIER_CONFIG.BASIC).toMatchObject({
        name: "Basic",
        liveDiscountLimit: 3,
        price: 9.99,
      });
      expect(TIER_CONFIG.BASIC.features).toBeInstanceOf(Array);

      expect(TIER_CONFIG.ADVANCED).toMatchObject({
        name: "Advanced",
        liveDiscountLimit: null,
        price: 19.99,
      });
      expect(TIER_CONFIG.ADVANCED.features).toBeInstanceOf(Array);
    });
  });

  describe("TIER_KEYS", () => {
    it("is ['FREE', 'BASIC', 'ADVANCED']", () => {
      expect(TIER_KEYS).toEqual(["FREE", "BASIC", "ADVANCED"]);
    });
  });

  describe("getTierPrice", () => {
    it("returns 0 for FREE tier", () => {
      expect(getTierPrice("FREE")).toBe(0);
    });

    it("returns 9.99 for BASIC tier", () => {
      expect(getTierPrice("BASIC")).toBe(9.99);
    });

    it("returns 19.99 for ADVANCED tier", () => {
      expect(getTierPrice("ADVANCED")).toBe(19.99);
    });

    it("returns 0 for unknown tier", () => {
      expect(getTierPrice("UNKNOWN")).toBe(0);
      expect(getTierPrice("invalid")).toBe(0);
    });

    it("returns 0 for null", () => {
      expect(getTierPrice(null)).toBe(0);
    });

    it("returns 0 for undefined", () => {
      expect(getTierPrice(undefined)).toBe(0);
    });
  });

  describe("getAvailableTiers", () => {
    it("returns 3 items", () => {
      const tiers = getAvailableTiers();
      expect(tiers).toHaveLength(3);
    });

    it("each item has correct shape", () => {
      const tiers = getAvailableTiers();

      tiers.forEach((tier) => {
        expect(tier).toHaveProperty("key");
        expect(tier).toHaveProperty("name");
        expect(tier).toHaveProperty("price");
        expect(tier).toHaveProperty("liveDiscountLimit");
        expect(tier).toHaveProperty("features");
        expect(tier).toHaveProperty("isUnlimited");

        expect(typeof tier.key).toBe("string");
        expect(typeof tier.name).toBe("string");
        expect(typeof tier.price).toBe("number");
        expect(Array.isArray(tier.features)).toBe(true);
        expect(typeof tier.isUnlimited).toBe("boolean");
      });
    });

    it("ADVANCED tier has isUnlimited=true", () => {
      const tiers = getAvailableTiers();
      const advanced = tiers.find((t) => t.key === "ADVANCED");

      expect(advanced).toBeDefined();
      expect(advanced.isUnlimited).toBe(true);
      expect(advanced.liveDiscountLimit).toBeNull();
    });

    it("FREE and BASIC tiers have isUnlimited=false", () => {
      const tiers = getAvailableTiers();
      const free = tiers.find((t) => t.key === "FREE");
      const basic = tiers.find((t) => t.key === "BASIC");

      expect(free.isUnlimited).toBe(false);
      expect(basic.isUnlimited).toBe(false);
    });
  });

  describe("getEffectiveTierFromShopRecord", () => {
    it("returns valid tier from shop record", () => {
      expect(getEffectiveTierFromShopRecord({ tier: "FREE" })).toBe("FREE");
      expect(getEffectiveTierFromShopRecord({ tier: "BASIC" })).toBe("BASIC");
      expect(getEffectiveTierFromShopRecord({ tier: "ADVANCED" })).toBe("ADVANCED");
    });

    it("defaults to FREE for null shop", () => {
      expect(getEffectiveTierFromShopRecord(null)).toBe("FREE");
    });

    it("defaults to FREE for undefined shop", () => {
      expect(getEffectiveTierFromShopRecord(undefined)).toBe("FREE");
    });

    it("defaults to FREE for missing tier field", () => {
      expect(getEffectiveTierFromShopRecord({})).toBe("FREE");
      expect(getEffectiveTierFromShopRecord({ domain: "test.myshopify.com" })).toBe("FREE");
    });

    it("defaults to FREE for invalid tier string", () => {
      expect(getEffectiveTierFromShopRecord({ tier: "UNKNOWN" })).toBe("FREE");
      expect(getEffectiveTierFromShopRecord({ tier: "invalid" })).toBe("FREE");
      expect(getEffectiveTierFromShopRecord({ tier: "" })).toBe("FREE");
    });

    it("defaults to FREE for non-string tier", () => {
      expect(getEffectiveTierFromShopRecord({ tier: 123 })).toBe("FREE");
      expect(getEffectiveTierFromShopRecord({ tier: true })).toBe("FREE");
      expect(getEffectiveTierFromShopRecord({ tier: null })).toBe("FREE");
    });
  });

  describe("isFeatureEnabled", () => {
    describe("FREE tier", () => {
      it("has no premium features", () => {
        expect(isFeatureEnabled("FREE", "fixedAmount")).toBe(false);
        expect(isFeatureEnabled("FREE", "autoApply")).toBe(false);
        expect(isFeatureEnabled("FREE", "subscription")).toBe(false);
        expect(isFeatureEnabled("FREE", "variantSpecific")).toBe(false);
      });
    });

    describe("BASIC tier", () => {
      it("has fixedAmount and autoApply", () => {
        expect(isFeatureEnabled("BASIC", "fixedAmount")).toBe(true);
        expect(isFeatureEnabled("BASIC", "autoApply")).toBe(true);
      });

      it("does not have subscription and variantSpecific", () => {
        expect(isFeatureEnabled("BASIC", "subscription")).toBe(false);
        expect(isFeatureEnabled("BASIC", "variantSpecific")).toBe(false);
      });
    });

    describe("ADVANCED tier", () => {
      it("has all features", () => {
        expect(isFeatureEnabled("ADVANCED", "fixedAmount")).toBe(true);
        expect(isFeatureEnabled("ADVANCED", "autoApply")).toBe(true);
        expect(isFeatureEnabled("ADVANCED", "subscription")).toBe(true);
        expect(isFeatureEnabled("ADVANCED", "variantSpecific")).toBe(true);
      });
    });

    describe("unknown tier", () => {
      it("has no features", () => {
        expect(isFeatureEnabled("UNKNOWN", "fixedAmount")).toBe(false);
        expect(isFeatureEnabled("UNKNOWN", "autoApply")).toBe(false);
        expect(isFeatureEnabled("UNKNOWN", "subscription")).toBe(false);
        expect(isFeatureEnabled("UNKNOWN", "variantSpecific")).toBe(false);
      });
    });

    describe("unknown feature", () => {
      it("returns false for all tiers", () => {
        expect(isFeatureEnabled("FREE", "unknownFeature")).toBe(false);
        expect(isFeatureEnabled("BASIC", "unknownFeature")).toBe(false);
        expect(isFeatureEnabled("ADVANCED", "unknownFeature")).toBe(false);
      });
    });
  });

  describe("getLiveDiscountLimit", () => {
    it("returns 1 for FREE tier", () => {
      expect(getLiveDiscountLimit("FREE")).toBe(1);
    });

    it("returns 3 for BASIC tier", () => {
      expect(getLiveDiscountLimit("BASIC")).toBe(3);
    });

    it("returns null for ADVANCED tier (unlimited)", () => {
      expect(getLiveDiscountLimit("ADVANCED")).toBeNull();
    });

    it("returns 1 for unknown tier", () => {
      expect(getLiveDiscountLimit("UNKNOWN")).toBe(1);
      expect(getLiveDiscountLimit("invalid")).toBe(1);
    });

    it("returns 1 for null", () => {
      expect(getLiveDiscountLimit(null)).toBe(1);
    });

    it("returns 1 for undefined", () => {
      expect(getLiveDiscountLimit(undefined)).toBe(1);
    });
  });
});
