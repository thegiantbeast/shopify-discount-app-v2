/**
 * Shared test fixtures for Discount Display Pro v2 tests
 */

// =========================
// Shop fixtures
// =========================
export const MOCK_SHOP_DOMAIN = "test-store.myshopify.com";

export function createMockShop(overrides = {}) {
  return {
    id: "shop-uuid-1",
    domain: MOCK_SHOP_DOMAIN,
    tier: "FREE",
    liveDiscountLimit: 1,
    billingTier: "FREE",
    billingStatus: "ACTIVE",
    installStatus: "done",
    pendingTier: null,
    pendingTierEffectiveAt: null,
    pendingTierSourceSubscriptionId: null,
    pendingTierContext: null,
    trialEndsAt: null,
    trialRecordedAt: null,
    trialSourceSubscriptionId: null,
    billingCurrentPeriodEnd: null,
    storefrontToken: "a".repeat(64),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// =========================
// Discount fixtures
// =========================
export const MOCK_DISCOUNT_GID = "gid://shopify/DiscountAutomaticNode/1234567890";
export const MOCK_CODE_DISCOUNT_GID = "gid://shopify/DiscountCodeNode/9876543210";

export function createMockDiscountData(overrides = {}) {
  return {
    __typename: "DiscountAutomaticBasic",
    title: "Summer Sale 20%",
    status: "ACTIVE",
    startsAt: "2024-01-01T00:00:00Z",
    endsAt: null,
    summary: "20% off selected products",
    discountClass: "PRODUCT",
    discountClasses: ["PRODUCT"],
    context: { __typename: "DiscountContextAll" },
    minimumRequirement: null,
    customerGets: {
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false,
      items: {
        products: {
          nodes: [
            { id: "gid://shopify/Product/111" },
            { id: "gid://shopify/Product/222" },
          ],
        },
      },
      value: {
        percentage: 0.2,
      },
    },
    ...overrides,
  };
}

export function createMockCodeDiscountData(overrides = {}) {
  return {
    __typename: "DiscountCodeBasic",
    title: "SAVE10",
    status: "ACTIVE",
    startsAt: "2024-01-01T00:00:00Z",
    endsAt: null,
    summary: "10% off with code SAVE10",
    discountClass: "PRODUCT",
    discountClasses: ["PRODUCT"],
    context: { __typename: "DiscountContextAll" },
    minimumRequirement: null,
    codesCount: { count: 1 },
    codes: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{ code: "SAVE10", id: "gid://shopify/DiscountRedeemCode/1" }],
    },
    customerGets: {
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false,
      items: {
        products: {
          nodes: [{ id: "gid://shopify/Product/111" }],
        },
      },
      value: {
        percentage: 0.1,
      },
    },
    ...overrides,
  };
}

export function createMockFixedAmountDiscount(overrides = {}) {
  return createMockDiscountData({
    title: "Save $5",
    summary: "$5 off selected products",
    customerGets: {
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false,
      items: {
        products: {
          nodes: [{ id: "gid://shopify/Product/111" }],
        },
      },
      value: {
        amount: { amount: "5.00", currencyCode: "USD" },
      },
    },
    ...overrides,
  });
}

export function createMockBxgyDiscount(overrides = {}) {
  return {
    __typename: "DiscountAutomaticBxgy",
    title: "Buy 2 Get 1 Free",
    status: "ACTIVE",
    startsAt: "2024-01-01T00:00:00Z",
    endsAt: null,
    summary: "Buy 2 get 1 free",
    discountClass: "PRODUCT",
    context: { __typename: "DiscountContextAll" },
    customerGets: {
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false,
      items: {
        products: { nodes: [{ id: "gid://shopify/Product/111" }] },
      },
      value: { percentage: 1.0 },
    },
    ...overrides,
  };
}

export function createMockSubscriptionDiscount(overrides = {}) {
  return createMockDiscountData({
    title: "Subscription 15% Off",
    summary: "15% off subscription purchases",
    customerGets: {
      appliesOnOneTimePurchase: false,
      appliesOnSubscription: true,
      items: {
        products: {
          nodes: [{ id: "gid://shopify/Product/111" }],
        },
      },
      value: { percentage: 0.15 },
    },
    ...overrides,
  });
}

export function createMockVariantDiscount(overrides = {}) {
  return createMockDiscountData({
    title: "Variant Sale",
    summary: "25% off specific variants",
    customerGets: {
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false,
      items: {
        productVariants: {
          nodes: [
            { id: "gid://shopify/ProductVariant/444" },
            { id: "gid://shopify/ProductVariant/555" },
          ],
        },
      },
      value: { percentage: 0.25 },
    },
    ...overrides,
  });
}

export function createMockScheduledDiscount(overrides = {}) {
  const future = new Date();
  future.setMonth(future.getMonth() + 1);
  return createMockDiscountData({
    title: "Future Sale",
    status: "ACTIVE",
    startsAt: future.toISOString(),
    ...overrides,
  });
}

export function createMockExpiredDiscount(overrides = {}) {
  return createMockDiscountData({
    title: "Expired Sale",
    status: "EXPIRED",
    startsAt: "2023-01-01T00:00:00Z",
    endsAt: "2023-06-01T00:00:00Z",
    ...overrides,
  });
}

// =========================
// Collection fixtures
// =========================
export function createMockCollection(overrides = {}) {
  return {
    id: "collection-uuid-1",
    gid: "gid://shopify/Collection/100",
    title: "Summer Collection",
    shop: MOCK_SHOP_DOMAIN,
    shopId: "shop-uuid-1",
    productIds: JSON.stringify([
      "gid://shopify/Product/111",
      "gid://shopify/Product/222",
    ]),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// =========================
// Product fixtures
// =========================
export function createMockProduct(overrides = {}) {
  return {
    id: "product-uuid-1",
    gid: "gid://shopify/Product/111",
    title: "Test Product",
    handle: "test-product",
    shop: MOCK_SHOP_DOMAIN,
    shopId: "shop-uuid-1",
    variantIds: JSON.stringify([
      "gid://shopify/ProductVariant/444",
      "gid://shopify/ProductVariant/555",
    ]),
    singlePrice: true,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// =========================
// LiveDiscount fixtures
// =========================
export function createMockLiveDiscount(overrides = {}) {
  return {
    id: "live-discount-uuid-1",
    gid: MOCK_DISCOUNT_GID,
    shop: MOCK_SHOP_DOMAIN,
    shopId: "shop-uuid-1",
    summary: "20% off selected products",
    discountType: "AUTO",
    status: "LIVE",
    startsAt: new Date("2024-01-01T00:00:00Z"),
    endsAt: null,
    exclusionReason: null,
    exclusionDetails: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// =========================
// Webhook payload fixtures
// =========================
export function createMockWebhookPayload(overrides = {}) {
  return {
    admin_graphql_api_id: MOCK_DISCOUNT_GID,
    id: 1234567890,
    title: "Summer Sale 20%",
    ...overrides,
  };
}

// =========================
// GraphQL response fixtures
// =========================
export function createMockGraphQLDiscountResponse(discountData) {
  return {
    data: {
      discountNode: {
        id: MOCK_DISCOUNT_GID,
        discount: discountData || createMockDiscountData(),
      },
    },
  };
}

// =========================
// DB mock helpers
// =========================
export function createMockPrisma() {
  return {
    shop: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
    discount: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    liveDiscount: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    collection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    product: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    discountTarget: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    discountProduct: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    discountVariant: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    discountCode: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    planSubscriptionLog: {
      create: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    setupTask: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn((args) => {
      if (Array.isArray(args)) return Promise.all(args);
      return args(createMockPrisma());
    }),
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
  };
}
