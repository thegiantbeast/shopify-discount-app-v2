-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'FREE',
    "liveDiscountLimit" INTEGER,
    "billingTier" TEXT NOT NULL DEFAULT 'FREE',
    "billingStatus" TEXT,
    "installStatus" TEXT,
    "pendingTier" TEXT,
    "pendingTierEffectiveAt" DATETIME,
    "pendingTierSourceSubscriptionId" TEXT,
    "pendingTierContext" JSONB,
    "trialEndsAt" DATETIME,
    "trialRecordedAt" DATETIME,
    "trialSourceSubscriptionId" TEXT,
    "billingCurrentPeriodEnd" DATETIME,
    "storefrontToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gid" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "summary" TEXT,
    "discountClass" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "percentage" REAL,
    "amount" REAL,
    "currencyCode" TEXT,
    "appliesOnOneTimePurchase" BOOLEAN NOT NULL DEFAULT true,
    "appliesOnSubscription" BOOLEAN NOT NULL DEFAULT false,
    "customerSelectionAll" BOOLEAN NOT NULL DEFAULT true,
    "customerSegments" TEXT NOT NULL DEFAULT '[]',
    "minimumRequirement" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Discount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productIds" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Collection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "shop" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantIds" TEXT NOT NULL,
    "singlePrice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveDiscount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gid" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "summary" TEXT,
    "discountType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "exclusionReason" TEXT,
    "exclusionDetails" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveDiscount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetupTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "buttonText" TEXT NOT NULL,
    "buttonUrl" TEXT NOT NULL,
    "buttonVariant" TEXT NOT NULL DEFAULT 'secondary',
    "target" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SetupTask_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanSubscriptionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT,
    "status" TEXT,
    "subscriptionId" TEXT,
    "planHandle" TEXT,
    "planName" TEXT,
    "interval" TEXT,
    "priceAmount" REAL,
    "priceCurrency" TEXT,
    "discountPercentage" REAL,
    "discountAmount" REAL,
    "discountCurrency" TEXT,
    "discountDurationLimit" INTEGER,
    "discountRemainingDuration" INTEGER,
    "currentPeriodEnd" DATETIME,
    "trialDays" INTEGER,
    "trialEnd" DATETIME,
    "trialActive" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DiscountTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discountId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetGid" TEXT NOT NULL,
    CONSTRAINT "DiscountTarget_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscountProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discountId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    CONSTRAINT "DiscountProduct_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscountVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discountId" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    CONSTRAINT "DiscountVariant_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    CONSTRAINT "DiscountCode_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "Shop_pendingTierEffectiveAt_idx" ON "Shop"("pendingTierEffectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_gid_key" ON "Discount"("gid");

-- CreateIndex
CREATE INDEX "Discount_shop_idx" ON "Discount"("shop");

-- CreateIndex
CREATE INDEX "Discount_shop_status_idx" ON "Discount"("shop", "status");

-- CreateIndex
CREATE INDEX "Discount_shop_gid_idx" ON "Discount"("shop", "gid");

-- CreateIndex
CREATE INDEX "Discount_shopId_idx" ON "Discount"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_gid_key" ON "Collection"("gid");

-- CreateIndex
CREATE INDEX "Collection_shop_idx" ON "Collection"("shop");

-- CreateIndex
CREATE INDEX "Collection_shop_gid_idx" ON "Collection"("shop", "gid");

-- CreateIndex
CREATE INDEX "Collection_shopId_idx" ON "Collection"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_gid_key" ON "Product"("gid");

-- CreateIndex
CREATE INDEX "Product_shop_idx" ON "Product"("shop");

-- CreateIndex
CREATE INDEX "Product_shop_gid_idx" ON "Product"("shop", "gid");

-- CreateIndex
CREATE INDEX "Product_shopId_idx" ON "Product"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveDiscount_gid_key" ON "LiveDiscount"("gid");

-- CreateIndex
CREATE INDEX "LiveDiscount_shop_idx" ON "LiveDiscount"("shop");

-- CreateIndex
CREATE INDEX "LiveDiscount_shop_status_idx" ON "LiveDiscount"("shop", "status");

-- CreateIndex
CREATE INDEX "LiveDiscount_shopId_idx" ON "LiveDiscount"("shopId");

-- CreateIndex
CREATE INDEX "SetupTask_shop_idx" ON "SetupTask"("shop");

-- CreateIndex
CREATE INDEX "SetupTask_shopId_idx" ON "SetupTask"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "SetupTask_shop_title_key" ON "SetupTask"("shop", "title");

-- CreateIndex
CREATE INDEX "PlanSubscriptionLog_shopDomain_createdAt_idx" ON "PlanSubscriptionLog"("shopDomain", "createdAt");

-- CreateIndex
CREATE INDEX "PlanSubscriptionLog_subscriptionId_idx" ON "PlanSubscriptionLog"("subscriptionId");

-- CreateIndex
CREATE INDEX "DiscountTarget_discountId_idx" ON "DiscountTarget"("discountId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountTarget_discountId_targetType_targetGid_key" ON "DiscountTarget"("discountId", "targetType", "targetGid");

-- CreateIndex
CREATE INDEX "DiscountProduct_discountId_idx" ON "DiscountProduct"("discountId");

-- CreateIndex
CREATE INDEX "DiscountProduct_productGid_idx" ON "DiscountProduct"("productGid");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountProduct_discountId_productGid_key" ON "DiscountProduct"("discountId", "productGid");

-- CreateIndex
CREATE INDEX "DiscountVariant_discountId_idx" ON "DiscountVariant"("discountId");

-- CreateIndex
CREATE INDEX "DiscountVariant_variantGid_idx" ON "DiscountVariant"("variantGid");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountVariant_discountId_variantGid_key" ON "DiscountVariant"("discountId", "variantGid");

-- CreateIndex
CREATE INDEX "DiscountCode_discountId_idx" ON "DiscountCode"("discountId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_discountId_code_key" ON "DiscountCode"("discountId", "code");
