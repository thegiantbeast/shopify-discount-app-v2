import {
  computeDiscountType,
  getTemporalBounds,
  isExpiredStatus,
  isPastEndDate,
} from "../../utils/discount-resolver/status-utils.server.js";

describe("status-utils", () => {
  describe("computeDiscountType", () => {
    it("should return CODE for DiscountCodeNode GIDs", () => {
      const result = computeDiscountType("gid://shopify/DiscountCodeNode/123");
      expect(result).toBe("CODE");
    });

    it("should return AUTO for DiscountAutomaticNode GIDs", () => {
      const result = computeDiscountType("gid://shopify/DiscountAutomaticNode/456");
      expect(result).toBe("AUTO");
    });

    it("should return AUTO for GIDs containing DiscountCode but not DiscountCodeNode", () => {
      const result = computeDiscountType("gid://shopify/DiscountCodeBasicNode/789");
      expect(result).toBe("AUTO");
    });

    it("should return CODE for DiscountCodeNode GIDs with extra path segments", () => {
      const result = computeDiscountType("gid://shopify/DiscountCodeNode/xyz/extra");
      expect(result).toBe("CODE");
    });
  });

  describe("getTemporalBounds", () => {
    it("should return correct Date objects for valid startsAt and endsAt", () => {
      const discountData = {
        startsAt: "2025-01-01T00:00:00Z",
        endsAt: "2025-12-31T23:59:59Z",
      };
      const result = getTemporalBounds(discountData);

      expect(result.startsAt).toBeInstanceOf(Date);
      expect(result.endsAt).toBeInstanceOf(Date);
      expect(result.startsAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
      expect(result.endsAt.toISOString()).toBe("2025-12-31T23:59:59.000Z");
    });

    it("should default startsAt to approximately now when missing", () => {
      const before = new Date();
      const result = getTemporalBounds({ endsAt: "2025-12-31T23:59:59Z" });
      const after = new Date();

      expect(result.startsAt).toBeInstanceOf(Date);
      expect(result.startsAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.startsAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should return null for missing endsAt", () => {
      const result = getTemporalBounds({ startsAt: "2025-01-01T00:00:00Z" });
      expect(result.endsAt).toBeNull();
    });

    it("should default startsAt to now for invalid startsAt string", () => {
      const before = new Date();
      const result = getTemporalBounds({ startsAt: "invalid-date" });
      const after = new Date();

      expect(result.startsAt).toBeInstanceOf(Date);
      expect(result.startsAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.startsAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should return null for invalid endsAt string", () => {
      const result = getTemporalBounds({
        startsAt: "2025-01-01T00:00:00Z",
        endsAt: "invalid-date",
      });
      expect(result.endsAt).toBeNull();
    });

    it("should handle null discountData with defaults", () => {
      const before = new Date();
      const result = getTemporalBounds(null);
      const after = new Date();

      expect(result.startsAt).toBeInstanceOf(Date);
      expect(result.startsAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.startsAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(result.endsAt).toBeNull();
    });
  });

  describe("isExpiredStatus", () => {
    it("should return true for EXPIRED status", () => {
      expect(isExpiredStatus("EXPIRED")).toBe(true);
    });

    it("should return false for ACTIVE status", () => {
      expect(isExpiredStatus("ACTIVE")).toBe(false);
    });

    it("should return false for SCHEDULED status", () => {
      expect(isExpiredStatus("SCHEDULED")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isExpiredStatus(null)).toBe(false);
    });
  });

  describe("isPastEndDate", () => {
    it("should return true when now is past the end date", () => {
      const pastDate = new Date("2020-01-01T00:00:00Z");
      const now = new Date("2025-01-01T00:00:00Z");
      expect(isPastEndDate(pastDate, now)).toBe(true);
    });

    it("should return false when now is before the end date", () => {
      const futureDate = new Date("2030-01-01T00:00:00Z");
      const now = new Date("2025-01-01T00:00:00Z");
      expect(isPastEndDate(futureDate, now)).toBe(false);
    });

    it("should return falsy for null endsAt", () => {
      const now = new Date("2025-01-01T00:00:00Z");
      expect(isPastEndDate(null, now)).toBeFalsy();
    });

    it("should return false when now equals endsAt", () => {
      const date = new Date("2025-01-01T00:00:00Z");
      const now = new Date("2025-01-01T00:00:00Z");
      expect(isPastEndDate(date, now)).toBe(false);
    });
  });
});
