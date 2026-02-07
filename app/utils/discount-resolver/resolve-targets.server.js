import { createLogger } from "../logger.server.js";
import {
  fetchCollectionProducts,
  fetchVariantProductAndAllVariants,
} from "./fetchers.server.js";
import { storeProductData } from "./store-data.server.js";
import { ensureArray, isProductDiscount, parseGid } from "./utils.server.js";

const logger = createLogger("ResolveTargets");

/**
 * Resolve a discount's targeting rules into concrete product/variant GID lists.
 *
 * @param {object} admin - Shopify admin GraphQL client
 * @param {object} discountData - The discount data from Shopify (discount.discount)
 * @param {string} shop - Shop domain
 * @param {object} db - Prisma client
 * @param {object} options - { forceRefresh: boolean }
 * @returns {Promise<{productIds: string[], variantIds: string[]}|null>}
 */
export async function resolveDiscountTargets(admin, discountData, shop, db, options = {}) {
  if (!isProductDiscount(discountData)) {
    return null;
  }

  if (!discountData?.customerGets || !discountData.customerGets.items) {
    return null;
  }

  const itemsArray = ensureArray(discountData.customerGets.items);
  const forceRefresh = !!options.forceRefresh;
  const resolvedProductIds = new Set();
  const resolvedVariantIds = new Set();

  for (const item of itemsArray) {
    if (!item) continue;

    // Handle collection targets
    if (item.collections?.nodes) {
      for (const collection of item.collections.nodes) {
        const parsed = parseGid(collection.id);
        if (parsed) {
          const productIds = await fetchCollectionProducts(
            admin,
            parsed.id,
            shop,
            db,
            { forceRefresh },
          );
          for (const pid of productIds) {
            resolvedProductIds.add(pid);
          }
          // Store each product from the collection
          for (const pid of productIds) {
            try {
              await storeProductData(admin, pid, shop, db, { forceRefresh });
            } catch (error) {
              logger.error(
                { err: error, collectionId: collection.id, productGid: pid },
                "Error storing product from collection"
              );
            }
          }
        }
      }
    }

    // Handle direct product targets
    if (item.products?.nodes) {
      for (const product of item.products.nodes) {
        resolvedProductIds.add(product.id);
        try {
          await storeProductData(admin, product.id, shop, db, { forceRefresh });
        } catch (error) {
          logger.error(
            { err: error, productGid: product.id },
            "Error storing directly targeted product"
          );
        }
      }
    }

    // Handle variant targets
    if (item.productVariants?.nodes) {
      for (const variant of item.productVariants.nodes) {
        resolvedVariantIds.add(variant.id);

        try {
          const { productId } = await fetchVariantProductAndAllVariants(
            admin,
            variant.id,
            shop,
            db,
            { forceRefresh },
          );
          if (productId) {
            resolvedProductIds.add(productId);
          }
        } catch (error) {
          logger.error(
            { err: error, variantGid: variant.id },
            "Error resolving variant's parent product"
          );
        }
      }
    }
  }

  return {
    productIds: Array.from(resolvedProductIds),
    variantIds: Array.from(resolvedVariantIds),
  };
}
