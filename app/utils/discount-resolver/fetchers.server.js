import { createLogger } from "../logger.server.js";
import { graphqlQuery } from "./graphql-client.server.js";
import { getCollectionFromDB, getProductFromDB } from "./db-cache.server.js";
import { GET_INITIAL_DISCOUNTS_QUERY } from "./graphql-queries.server.js";

const logger = createLogger("Fetchers");

const MAX_ITEMS_SAFETY_LIMIT = 10000;

/**
 * Fetch initial discounts with cursor-based pagination.
 * Applies server-side filter: status:active AND discount_class:product
 * Then client-side filters for minimum requirements and customer segments.
 */
export async function fetchInitialDiscounts(admin, shop) {
  try {
    const allDiscounts = [];
    let hasNextPage = true;
    let after = null;

    while (hasNextPage) {
      const result = await graphqlQuery(admin, GET_INITIAL_DISCOUNTS_QUERY, { after });
      const data = result.data;

      if (!data?.discountNodes?.edges) {
        break;
      }

      for (const edge of data.discountNodes.edges) {
        const discount = edge.node.discount;
        if (discount) {
          allDiscounts.push({ id: edge.node.id, ...discount });
        }
      }

      hasNextPage = data.discountNodes.pageInfo.hasNextPage;
      after = hasNextPage ? data.discountNodes.pageInfo.endCursor : null;

      if (allDiscounts.length >= MAX_ITEMS_SAFETY_LIMIT) {
        logger.warn(
          "Hit safety limit during initial discount fetch",
          { shop, count: allDiscounts.length }
        );
        break;
      }
    }

    const filteredDiscounts = allDiscounts.filter((discount) => {
      if (
        discount.minimumRequirement?.greaterThanOrEqualToSubtotal ||
        discount.minimumRequirement?.greaterThanOrEqualToQuantity
      ) {
        return false;
      }

      const selection = discount.context || discount.customerSelection;
      const selectionType =
        selection && typeof selection.__typename === "string"
          ? selection.__typename.toLowerCase()
          : null;
      const isAllCustomers = !selectionType || selectionType.includes("all");
      return isAllCustomers;
    });

    logger.info(
      "Initial discount fetch complete",
      { shop, total: allDiscounts.length, filtered: filteredDiscounts.length }
    );

    return filteredDiscounts.map((discount) => ({
      gid: discount.id,
      summary: discount.summary,
      __typename: discount.__typename,
      startsAt: discount.startsAt,
      endsAt: discount.endsAt,
    }));
  } catch (error) {
    logger.error("Error fetching initial discounts", { err: error, shop });
    return [];
  }
}

/**
 * Fetch all products in a collection with full cursor-based pagination.
 * Uses DB cache first; fetches from Shopify if cache miss or forceRefresh.
 *
 * @param {object} admin - Shopify admin client
 * @param {string} collectionId - Numeric collection ID (not full GID)
 * @param {string} shop - Shop domain
 * @param {object} db - Prisma client
 * @param {object} options - { forceRefresh: boolean }
 * @returns {Promise<string[]>} Array of product GIDs
 */
export async function fetchCollectionProducts(admin, collectionId, shop, db, options = {}) {
  try {
    const collectionGid = `gid://shopify/Collection/${collectionId}`;
    const forceRefresh = !!options.forceRefresh;

    if (!forceRefresh) {
      const cachedProductIds = await getCollectionFromDB(collectionGid, shop, db);
      if (cachedProductIds && cachedProductIds.length > 0) {
        return cachedProductIds;
      }
    }

    const products = [];
    let hasNextPage = true;
    let after = null;

    while (hasNextPage) {
      const query = `
        query getCollectionProducts($id: ID!, $after: String) {
          collection(id: $id) {
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

      if (!data?.collection?.products?.edges) {
        break;
      }

      const edges = data.collection.products.edges;
      products.push(...edges.map((edge) => edge.node.id));
      hasNextPage = data.collection.products.pageInfo.hasNextPage;
      after = hasNextPage ? data.collection.products.pageInfo.endCursor : null;

      if (products.length >= MAX_ITEMS_SAFETY_LIMIT) {
        logger.warn(
          "Hit safety limit fetching collection products",
          { shop, collectionGid, count: products.length }
        );
        break;
      }
    }

    return products;
  } catch (error) {
    logger.error(
      "Error fetching collection products",
      { err: error, collectionId, shop }
    );
    return [];
  }
}

/**
 * Fetch a variant's parent product and all sibling variants.
 * Uses DB cache first; fetches from Shopify if cache miss or forceRefresh.
 *
 * @param {object} admin - Shopify admin client
 * @param {string} variantGid - Full variant GID
 * @param {string} shop - Shop domain
 * @param {object} db - Prisma client
 * @param {object} options - { forceRefresh: boolean }
 * @returns {Promise<{productId: string|null, variantIds: string[]}>}
 */
export async function fetchVariantProductAndAllVariants(admin, variantGid, shop, db, options = {}) {
  try {
    const forceRefresh = !!options.forceRefresh;

    const lookupQuery = `
      query getVariantProduct($id: ID!) {
        productVariant(id: $id) {
          product { id }
        }
      }
    `;
    const lookupResult = await graphqlQuery(admin, lookupQuery, { id: variantGid });
    const productId = lookupResult.data?.productVariant?.product?.id;
    if (!productId) return { productId: null, variantIds: [] };

    if (!forceRefresh) {
      const cachedVariantIds = await getProductFromDB(productId, shop, db);
      if (cachedVariantIds && cachedVariantIds.length > 0) {
        return { productId, variantIds: cachedVariantIds };
      }
    }

    const variantIds = [];
    let hasNextPage = true;
    let after = null;

    while (hasNextPage) {
      const variantsQuery = `
        query getProductVariants($id: ID!, $after: String) {
          product(id: $id) {
            variants(first: 250, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges {
                node { id }
              }
            }
          }
        }
      `;
      const result = await graphqlQuery(admin, variantsQuery, { id: productId, after });
      const data = result.data;

      if (!data?.product?.variants?.edges) {
        break;
      }

      const edges = data.product.variants.edges;
      variantIds.push(...edges.map((edge) => edge.node.id));
      hasNextPage = data.product.variants.pageInfo.hasNextPage;
      after = hasNextPage ? data.product.variants.pageInfo.endCursor : null;

      if (variantIds.length >= MAX_ITEMS_SAFETY_LIMIT) {
        logger.warn(
          "Hit safety limit fetching product variants",
          { shop, productId, count: variantIds.length }
        );
        break;
      }
    }

    return { productId, variantIds };
  } catch (error) {
    logger.error(
      "Error fetching variant product and all variants",
      { err: error, variantGid, shop }
    );
    return { productId: null, variantIds: [] };
  }
}

/**
 * Fetch all discount codes for a code discount with pagination.
 * Used when a discount has >100 codes (the initial fragment only fetches first 100).
 *
 * @param {object} admin - Shopify admin client
 * @param {string} discountId - Discount GID
 * @param {object} initialCodes - The initial codes response from DISCOUNT_FRAGMENT
 * @returns {Promise<string[]>} All code strings
 */
export async function fetchAllDiscountCodes(admin, discountId, initialCodes) {
  try {
    const codes = [];

    if (initialCodes?.nodes) {
      codes.push(...initialCodes.nodes.map((node) => node.code));
    }

    if (!initialCodes?.pageInfo?.hasNextPage) {
      return codes;
    }

    let hasNextPage = true;
    let after = initialCodes.pageInfo.endCursor;

    while (hasNextPage) {
      const query = `
        query GetDiscountCodes($id: ID!, $after: String) {
          codeDiscountNode(id: $id) {
            codeDiscount {
              ... on DiscountCodeBasic {
                codes(first: 100, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  nodes { code }
                }
              }
              ... on DiscountCodeBxgy {
                codes(first: 100, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  nodes { code }
                }
              }
              ... on DiscountCodeFreeShipping {
                codes(first: 100, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  nodes { code }
                }
              }
              ... on DiscountCodeApp {
                codes(first: 100, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  nodes { code }
                }
              }
            }
          }
        }
      `;
      const result = await graphqlQuery(admin, query, { id: discountId, after });
      const data = result.data;

      const codeDiscount = data?.codeDiscountNode?.codeDiscount;
      if (!codeDiscount) break;

      const codesData = codeDiscount.codes;
      if (!codesData?.nodes) break;

      codes.push(...codesData.nodes.map((node) => node.code));
      hasNextPage = codesData.pageInfo?.hasNextPage || false;
      after = hasNextPage ? codesData.pageInfo.endCursor : null;

      if (codes.length >= MAX_ITEMS_SAFETY_LIMIT) {
        logger.warn(
          "Hit safety limit fetching discount codes",
          { discountId, count: codes.length }
        );
        break;
      }
    }

    return codes;
  } catch (error) {
    logger.error("Error fetching all discount codes", { err: error, discountId });
    return initialCodes?.nodes?.map((n) => n.code) || [];
  }
}
