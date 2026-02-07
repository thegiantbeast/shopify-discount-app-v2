import {
  parseGid,
  getDiscountClassValue,
  ensureArray,
  isProductDiscount,
  isAllCustomersSelection,
  safeJsonParse,
  getShopIdByDomain,
} from "../../utils/discount-resolver/utils.server.js";

// Mock logger to prevent console output during tests
vi.mock("../../utils/logger.server.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("resolver-utils", () => {
  describe("parseGid", () => {
    it("should parse a valid Product GID", () => {
      const result = parseGid("gid://shopify/Product/123");
      expect(result).toEqual({
        type: "Product",
        id: "123",
        fullGid: "gid://shopify/Product/123",
      });
    });

    it("should parse a valid DiscountCodeNode GID", () => {
      const result = parseGid("gid://shopify/DiscountCodeNode/456");
      expect(result).toEqual({
        type: "DiscountCodeNode",
        id: "456",
        fullGid: "gid://shopify/DiscountCodeNode/456",
      });
    });

    it("should return null for null input", () => {
      expect(parseGid(null)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parseGid("")).toBeNull();
    });

    it("should return null for invalid format", () => {
      expect(parseGid("invalid")).toBeNull();
    });

    it("should return null for non-string input", () => {
      expect(parseGid(123)).toBeNull();
    });
  });

  describe("getDiscountClassValue", () => {
    it("should return discountClass when it is a string", () => {
      const result = getDiscountClassValue({ discountClass: "PRODUCT" });
      expect(result).toBe("PRODUCT");
    });

    it("should return first element from discountClasses array", () => {
      const result = getDiscountClassValue({ discountClasses: ["PRODUCT"] });
      expect(result).toBe("PRODUCT");
    });

    it("should prefer discountClass over discountClasses", () => {
      const result = getDiscountClassValue({
        discountClass: "PRODUCT",
        discountClasses: ["SHIPPING"],
      });
      expect(result).toBe("PRODUCT");
    });

    it("should return null for empty object", () => {
      const result = getDiscountClassValue({});
      expect(result).toBeNull();
    });

    it("should return null for null input", () => {
      const result = getDiscountClassValue(null);
      expect(result).toBeNull();
    });
  });

  describe("ensureArray", () => {
    it("should return the same array when input is an array", () => {
      const arr = [1, 2, 3];
      expect(ensureArray(arr)).toBe(arr);
    });

    it("should return empty array for null", () => {
      expect(ensureArray(null)).toEqual([]);
    });

    it("should return empty array for undefined", () => {
      expect(ensureArray(undefined)).toEqual([]);
    });

    it("should wrap single value in array", () => {
      expect(ensureArray("test")).toEqual(["test"]);
      expect(ensureArray(42)).toEqual([42]);
      expect(ensureArray({ foo: "bar" })).toEqual([{ foo: "bar" }]);
    });
  });

  describe("isProductDiscount", () => {
    it("should return true for PRODUCT discount class", () => {
      expect(isProductDiscount({ discountClass: "PRODUCT" })).toBe(true);
    });

    it("should return false for SHIPPING discount class", () => {
      expect(isProductDiscount({ discountClass: "SHIPPING" })).toBe(false);
    });

    it("should return true for lowercase product (case insensitive)", () => {
      expect(isProductDiscount({ discountClass: "product" })).toBe(true);
    });

    it("should return false for empty object", () => {
      expect(isProductDiscount({})).toBe(false);
    });

    it("should return false for null input", () => {
      expect(isProductDiscount(null)).toBe(false);
    });
  });

  describe("isAllCustomersSelection", () => {
    it("should return true for DiscountContextAll", () => {
      expect(isAllCustomersSelection({ __typename: "DiscountContextAll" })).toBe(true);
    });

    it("should return false for DiscountCustomerSegments", () => {
      expect(isAllCustomersSelection({ __typename: "DiscountCustomerSegments" })).toBe(false);
    });

    it("should return true for null selection", () => {
      expect(isAllCustomersSelection(null)).toBe(true);
    });

    it("should return true for empty object", () => {
      expect(isAllCustomersSelection({})).toBe(true);
    });

    it("should return true for any __typename containing 'all' (case insensitive)", () => {
      expect(isAllCustomersSelection({ __typename: "SomethingAllCustomers" })).toBe(true);
      expect(isAllCustomersSelection({ __typename: "AllUsers" })).toBe(true);
    });
  });

  describe("safeJsonParse", () => {
    it("should parse valid JSON string", () => {
      const result = safeJsonParse('{"foo":"bar"}');
      expect(result).toEqual({ foo: "bar" });
    });

    it("should return fallback for invalid JSON", () => {
      const result = safeJsonParse("invalid-json");
      expect(result).toEqual([]);
    });

    it("should return empty array for null", () => {
      const result = safeJsonParse(null);
      expect(result).toEqual([]);
    });

    it("should return empty array for empty string", () => {
      const result = safeJsonParse("");
      expect(result).toEqual([]);
    });

    it("should use custom fallback when provided", () => {
      const customFallback = { error: true };
      const result = safeJsonParse("invalid-json", customFallback);
      expect(result).toBe(customFallback);
    });

    it("should parse JSON arrays correctly", () => {
      const result = safeJsonParse('[1,2,3]');
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("getShopIdByDomain", () => {
    it("should return shop id when shop is found", async () => {
      const mockDb = {
        shop: {
          findUnique: vi.fn().mockResolvedValue({ id: 42 }),
        },
      };

      const result = await getShopIdByDomain("test-shop.myshopify.com", mockDb);

      expect(result).toBe(42);
      expect(mockDb.shop.findUnique).toHaveBeenCalledWith({
        where: { domain: "test-shop.myshopify.com" },
        select: { id: true },
      });
    });

    it("should return null when shop is not found", async () => {
      const mockDb = {
        shop: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const result = await getShopIdByDomain("nonexistent.myshopify.com", mockDb);

      expect(result).toBeNull();
      expect(mockDb.shop.findUnique).toHaveBeenCalledWith({
        where: { domain: "nonexistent.myshopify.com" },
        select: { id: true },
      });
    });
  });
});
