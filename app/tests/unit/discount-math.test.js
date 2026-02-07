import { describe, it, expect, vi } from "vitest";
import {
  calculateDiscountedPrice,
  calculateActualSavings,
  isDiscountEligibleForVariant,
  findBestDiscount,
  findBestDiscounts,
  resolveBestDiscounts,
} from "../../utils/discount-math.server.js";

// Mock the logger
vi.mock("../../utils/logger.server.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("discount-math.server.js", () => {
  describe("calculateDiscountedPrice", () => {
    it("applies 20% discount to 10000 cents correctly", () => {
      const discount = { type: "percentage", value: 20 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(8000);
    });

    it("applies 50% discount to 9999 cents using floor", () => {
      const discount = { type: "percentage", value: 50 };
      // 9999 * 0.5 = 4999.5 → floor to 4999 savings → 5000 final price
      expect(calculateDiscountedPrice(9999, discount)).toBe(5000);
    });

    it("applies 100% discount to return 0", () => {
      const discount = { type: "percentage", value: 100 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(0);
    });

    it("applies 0% discount with no change", () => {
      const discount = { type: "percentage", value: 0 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(10000);
    });

    it("clamps percentage > 100 to 100, returns 0", () => {
      const discount = { type: "percentage", value: 150 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(0);
    });

    it("clamps percentage < 0 to 0, no discount applied", () => {
      const discount = { type: "percentage", value: -10 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(10000);
    });

    it("applies fixed $5 discount to $100", () => {
      const discount = { type: "fixed", value: 500 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(9500);
    });

    it("clamps fixed amount > price to 0", () => {
      const discount = { type: "fixed", value: 15000 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(0);
    });

    it("applies fixed $0 discount with no change", () => {
      const discount = { type: "fixed", value: 0 };
      expect(calculateDiscountedPrice(10000, discount)).toBe(10000);
    });

    it("returns regularPriceCents for null discount", () => {
      expect(calculateDiscountedPrice(10000, null)).toBe(10000);
    });

    it("returns regularPriceCents for non-finite price", () => {
      const discount = { type: "percentage", value: 20 };
      expect(calculateDiscountedPrice(NaN, discount)).toBe(NaN);
      expect(calculateDiscountedPrice(Infinity, discount)).toBe(Infinity);
    });
  });

  describe("calculateActualSavings", () => {
    it("calculates 20% savings on 10000 cents", () => {
      const discount = { type: "percentage", value: 20 };
      expect(calculateActualSavings(10000, discount)).toBe(2000);
    });

    it("calculates 33% savings on 10000 cents using floor", () => {
      const discount = { type: "percentage", value: 33 };
      // 10000 * 0.33 = 3300
      expect(calculateActualSavings(10000, discount)).toBe(3300);
    });

    it("calculates fixed $5 savings on $100", () => {
      const discount = { type: "fixed", value: 500 };
      expect(calculateActualSavings(10000, discount)).toBe(500);
    });

    it("clamps fixed savings > price to price", () => {
      const discount = { type: "fixed", value: 15000 };
      expect(calculateActualSavings(10000, discount)).toBe(10000);
    });

    it("returns 0 for null discount", () => {
      expect(calculateActualSavings(10000, null)).toBe(0);
    });

    it("returns 0 for non-finite price", () => {
      const discount = { type: "percentage", value: 20 };
      expect(calculateActualSavings(NaN, discount)).toBe(0);
      expect(calculateActualSavings(Infinity, discount)).toBe(0);
    });
  });

  describe("isDiscountEligibleForVariant", () => {
    it("returns true for no scope", () => {
      const discount = { type: "percentage", value: 20, variantScope: null };
      expect(isDiscountEligibleForVariant(discount, "123")).toBe(true);
    });

    it("returns true for ALL scope", () => {
      const discount = {
        type: "percentage",
        value: 20,
        variantScope: { type: "ALL" },
      };
      expect(isDiscountEligibleForVariant(discount, "123")).toBe(true);
    });

    it("returns true for PARTIAL scope with matching ID", () => {
      const discount = {
        type: "percentage",
        value: 20,
        variantScope: { type: "PARTIAL", ids: ["123", "456"] },
      };
      expect(isDiscountEligibleForVariant(discount, "123")).toBe(true);
    });

    it("returns false for PARTIAL scope with non-matching ID", () => {
      const discount = {
        type: "percentage",
        value: 20,
        variantScope: { type: "PARTIAL", ids: ["123", "456"] },
      };
      expect(isDiscountEligibleForVariant(discount, "789")).toBe(false);
    });

    it("returns false for PARTIAL scope with null variantId", () => {
      const discount = {
        type: "percentage",
        value: 20,
        variantScope: { type: "PARTIAL", ids: ["123", "456"] },
      };
      expect(isDiscountEligibleForVariant(discount, null)).toBe(false);
    });

    it("handles numeric vs string ID coercion", () => {
      const discount = {
        type: "percentage",
        value: 20,
        variantScope: { type: "PARTIAL", ids: [123, 456] },
      };
      // String variant ID should match numeric ID in scope
      expect(isDiscountEligibleForVariant(discount, "123")).toBe(true);
      // Numeric variant ID should match string ID in scope
      const discount2 = {
        type: "percentage",
        value: 20,
        variantScope: { type: "PARTIAL", ids: ["123", "456"] },
      };
      expect(isDiscountEligibleForVariant(discount2, 123)).toBe(true);
    });
  });

  describe("findBestDiscount", () => {
    it("returns single eligible discount", () => {
      const discounts = [{ type: "percentage", value: 20, isAutomatic: true }];
      const result = findBestDiscount(discounts, 10000, null);
      expect(result).toEqual({
        discount: discounts[0],
        finalPrice: 8000,
        savings: 2000,
      });
    });

    it("picks discount with highest savings", () => {
      const discounts = [
        { type: "percentage", value: 10, isAutomatic: true },
        { type: "percentage", value: 20, isAutomatic: true },
        { type: "fixed", value: 1500, isAutomatic: false },
      ];
      const result = findBestDiscount(discounts, 10000, null);
      expect(result.discount).toBe(discounts[1]); // 20% = 2000 savings
      expect(result.savings).toBe(2000);
    });

    it("uses higher value as tiebreaker for same savings", () => {
      const discounts = [
        { type: "percentage", value: 20, isAutomatic: true },
        { type: "fixed", value: 2000, isAutomatic: false },
      ];
      const result = findBestDiscount(discounts, 10000, null);
      // Both save 2000 cents, but fixed has value 2000 > percentage value 20
      expect(result.discount).toBe(discounts[1]);
      expect(result.savings).toBe(2000);
    });

    it("returns null when all discounts are ineligible for variant", () => {
      const discounts = [
        {
          type: "percentage",
          value: 20,
          isAutomatic: true,
          variantScope: { type: "PARTIAL", ids: ["123"] },
        },
      ];
      const result = findBestDiscount(discounts, 10000, "999");
      expect(result).toBe(null);
    });

    it("returns null for empty array", () => {
      const result = findBestDiscount([], 10000, null);
      expect(result).toBe(null);
    });
  });

  describe("findBestDiscounts", () => {
    it("returns best automatic and best coupon separately", () => {
      const discounts = [
        { type: "percentage", value: 10, isAutomatic: true },
        { type: "percentage", value: 20, isAutomatic: true },
        { type: "percentage", value: 15, isAutomatic: false },
        { type: "fixed", value: 1000, isAutomatic: false },
      ];
      const result = findBestDiscounts(discounts, 10000, null);

      expect(result.automaticDiscount).toBe(discounts[1]); // 20% auto
      expect(result.automaticSavings).toBe(2000);
      expect(result.couponDiscount).toBe(discounts[2]); // 15% coupon
      expect(result.couponSavings).toBe(1500);
    });

    it("returns null coupon when only automatic discounts exist", () => {
      const discounts = [
        { type: "percentage", value: 10, isAutomatic: true },
        { type: "percentage", value: 20, isAutomatic: true },
      ];
      const result = findBestDiscounts(discounts, 10000, null);

      expect(result.automaticDiscount).toBe(discounts[1]);
      expect(result.couponDiscount).toBe(null);
      expect(result.couponFinalPrice).toBe(null);
      expect(result.couponSavings).toBe(null);
    });

    it("returns null automatic when only coupon discounts exist", () => {
      const discounts = [
        { type: "percentage", value: 15, isAutomatic: false },
        { type: "fixed", value: 1000, isAutomatic: false },
      ];
      const result = findBestDiscounts(discounts, 10000, null);

      expect(result.automaticDiscount).toBe(null);
      expect(result.automaticFinalPrice).toBe(null);
      expect(result.automaticSavings).toBe(null);
      expect(result.couponDiscount).toBe(discounts[0]); // 15% = 1500 savings
    });
  });

  describe("resolveBestDiscounts", () => {
    it("suppresses coupon when automatic is better", () => {
      const discounts = [
        { type: "percentage", value: 20, isAutomatic: true },
        { type: "percentage", value: 10, isAutomatic: false },
      ];
      const result = resolveBestDiscounts({
        discounts,
        regularPriceCents: 10000,
        currentVariantId: null,
      });

      expect(result.automaticDiscount).toBe(discounts[0]);
      expect(result.couponDiscount).toBe(null); // Suppressed
      expect(result.automaticEntry).toEqual({
        finalPriceCents: 8000,
        regularPriceCents: 10000,
      });
      expect(result.couponEntry).toBe(null);
      expect(result.basePriceCents).toBe(10000);
    });

    it("returns both when coupon is better than automatic", () => {
      const discounts = [
        { type: "percentage", value: 10, isAutomatic: true },
        { type: "percentage", value: 20, isAutomatic: false },
      ];
      const result = resolveBestDiscounts({
        discounts,
        regularPriceCents: 10000,
        currentVariantId: null,
      });

      expect(result.automaticDiscount).toBe(discounts[0]);
      expect(result.couponDiscount).toBe(discounts[1]); // Not suppressed
      expect(result.automaticEntry).toEqual({
        finalPriceCents: 9000,
        regularPriceCents: 10000,
      });
      expect(result.couponEntry).toEqual({
        finalPriceCents: 8000,
        regularPriceCents: 10000,
      });
    });

    it("suppresses coupon when automatic equals coupon", () => {
      const discounts = [
        { type: "percentage", value: 20, isAutomatic: true },
        { type: "fixed", value: 2000, isAutomatic: false },
      ];
      const result = resolveBestDiscounts({
        discounts,
        regularPriceCents: 10000,
        currentVariantId: null,
      });

      expect(result.automaticDiscount).toBe(discounts[0]);
      expect(result.couponDiscount).toBe(null); // Suppressed (equal savings)
      expect(result.couponEntry).toBe(null);
    });

    it("returns correctly when only automatic discount exists", () => {
      const discounts = [{ type: "percentage", value: 20, isAutomatic: true }];
      const result = resolveBestDiscounts({
        discounts,
        regularPriceCents: 10000,
        currentVariantId: null,
      });

      expect(result.automaticDiscount).toBe(discounts[0]);
      expect(result.couponDiscount).toBe(null);
      expect(result.automaticEntry).toEqual({
        finalPriceCents: 8000,
        regularPriceCents: 10000,
      });
      expect(result.couponEntry).toBe(null);
    });

    it("returns correctly when only coupon discount exists", () => {
      const discounts = [
        { type: "percentage", value: 20, isAutomatic: false },
      ];
      const result = resolveBestDiscounts({
        discounts,
        regularPriceCents: 10000,
        currentVariantId: null,
      });

      expect(result.automaticDiscount).toBe(null);
      expect(result.couponDiscount).toBe(discounts[0]);
      expect(result.automaticEntry).toBe(null);
      expect(result.couponEntry).toEqual({
        finalPriceCents: 8000,
        regularPriceCents: 10000,
      });
    });

    it("returns all null for invalid input (non-array discounts)", () => {
      const result = resolveBestDiscounts({
        discounts: "not an array",
        regularPriceCents: 10000,
        currentVariantId: null,
      });

      expect(result).toEqual({
        automaticDiscount: null,
        couponDiscount: null,
        automaticEntry: null,
        couponEntry: null,
        basePriceCents: null,
      });
    });

    it("returns all null for invalid input (non-number price)", () => {
      const discounts = [{ type: "percentage", value: 20, isAutomatic: true }];
      const result = resolveBestDiscounts({
        discounts,
        regularPriceCents: "10000",
        currentVariantId: null,
      });

      expect(result).toEqual({
        automaticDiscount: null,
        couponDiscount: null,
        automaticEntry: null,
        couponEntry: null,
        basePriceCents: null,
      });
    });
  });
});
