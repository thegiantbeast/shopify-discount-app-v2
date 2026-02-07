import { createLogger } from "../logger.server.js";
import { graphqlQuery } from "./graphql-client.server.js";

const logger = createLogger("StoreData");

/**
 * Fetch and store collection data (title + product GIDs).
 * Uses cursor-based pagination to get ALL products in the collection.
 */
export async function storeCollectionData(admin, collectionGid, shop, db, options = {}) {
  try {
    const forceRefresh = !!options.forceRefresh;

    const existingCollection = await db.collection.findFirst({
      where: { gid: collectionGid, shop },
    });

    if (existingCollection && !forceRefresh) {
      return;
    }

    const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
    if (!shopRecord) {
      logger.error("Shop not found for storeCollectionData", { shop, collectionGid });
      return;
    }

    let allProductIds = [];
    let collectionTitle = "";
    let hasNextPage = true;
    let after = null;

    while (hasNextPage) {
      const query = `
        query getCollectionProducts($id: ID!, $after: String) {
          collection(id: $id) {
            id
            title
            products(first: 250, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges {
                node { id }
              }
            }
          }
        }
      `;
      const result = await graphqlQuery(admin, query, { id: collectionGid, after });
      const data = result.data;

      if (!data?.collection) {
        return;
      }

      const collection = data.collection;
      const edges = collection.products.edges;
      allProductIds.push(...edges.map((edge) => edge.node.id));
      hasNextPage = collection.products.pageInfo.hasNextPage;
      after = hasNextPage ? collection.products.pageInfo.endCursor : null;

      if (!collectionTitle) {
        collectionTitle = collection.title;
      }

      if (allProductIds.length >= 10000) {
        logger.warn("Hit safety limit storing collection products", { shop, collectionGid, count: allProductIds.length });
        break;
      }
    }

    await db.collection.upsert({
      where: { gid: collectionGid },
      update: {
        title: collectionTitle,
        shop,
        shopId: shopRecord.id,
        productIds: JSON.stringify(allProductIds),
        updatedAt: new Date(),
      },
      create: {
        gid: collectionGid,
        title: collectionTitle,
        shop,
        shopId: shopRecord.id,
        productIds: JSON.stringify(allProductIds),
      },
    });
  } catch (error) {
    logger.error("Error storing collection data", { err: error, collectionGid, shop });
  }
}

/**
 * Fetch and store product data (title, handle, variants, singlePrice).
 * Uses cursor-based pagination to get ALL variants.
 */
export async function storeProductData(admin, productGid, shop, db, options = {}) {
  try {
    const forceRefresh = !!options.forceRefresh;

    const existingProduct = await db.product.findFirst({
      where: { gid: productGid, shop },
    });

    if (existingProduct && !forceRefresh) {
      return;
    }

    const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
    if (!shopRecord) {
      logger.error("Shop not found for storeProductData", { shop, productGid });
      return;
    }

    let allVariantIds = [];
    let productTitle = "";
    let productHandle = "";
    let hasNextPage = true;
    let after = null;
    let minAmount = null;
    let maxAmount = null;

    while (hasNextPage) {
      const query = `
        query getProductVariants($id: ID!, $after: String) {
          product(id: $id) {
            id
            title
            handle
            priceRangeV2 {
              minVariantPrice { amount }
              maxVariantPrice { amount }
            }
            variants(first: 250, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges {
                node { id }
              }
            }
          }
        }
      `;
      const result = await graphqlQuery(admin, query, { id: productGid, after });
      const data = result.data;

      if (!data?.product) {
        return;
      }

      const product = data.product;
      const edges = product.variants.edges;
      allVariantIds.push(...edges.map((edge) => edge.node.id));
      hasNextPage = product.variants.pageInfo.hasNextPage;
      after = hasNextPage ? product.variants.pageInfo.endCursor : null;

      if (!productTitle) {
        productTitle = product.title || "";
        productHandle = product.handle || "";
        try {
          const pr = product.priceRangeV2;
          if (pr?.minVariantPrice && pr?.maxVariantPrice) {
            minAmount = parseFloat(pr.minVariantPrice.amount);
            maxAmount = parseFloat(pr.maxVariantPrice.amount);
          }
        } catch {
          /* ignore parse errors */
        }
      }

      if (allVariantIds.length >= 10000) {
        logger.warn("Hit safety limit storing product variants", { shop, productGid, count: allVariantIds.length });
        break;
      }
    }

    const singlePrice =
      typeof minAmount === "number" &&
      typeof maxAmount === "number" &&
      !Number.isNaN(minAmount) &&
      !Number.isNaN(maxAmount)
        ? minAmount === maxAmount
        : false;

    await db.product.upsert({
      where: { gid: productGid },
      update: {
        title: productTitle,
        handle: productHandle || undefined,
        shop,
        shopId: shopRecord.id,
        variantIds: JSON.stringify(allVariantIds),
        singlePrice,
        updatedAt: new Date(),
      },
      create: {
        gid: productGid,
        title: productTitle,
        handle: productHandle || undefined,
        shop,
        shopId: shopRecord.id,
        variantIds: JSON.stringify(allVariantIds),
        singlePrice,
      },
    });
  } catch (error) {
    logger.error("Error storing product data", { err: error, productGid, shop });
  }
}
