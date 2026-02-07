import { createLogger } from "../logger.server.js";
import { safeJsonParse } from "./utils.server.js";

const logger = createLogger("DBCache");

export async function getCollectionFromDB(collectionGid, shop, db) {
  try {
    const collection = await db.collection.findFirst({
      where: { gid: collectionGid, shop },
    });
    if (collection) {
      return safeJsonParse(collection.productIds, []);
    }
    return null;
  } catch (error) {
    logger.error("Error checking collection in DB", { err: error, collectionGid });
    return null;
  }
}

export async function getProductFromDB(productGid, shop, db) {
  try {
    const product = await db.product.findFirst({
      where: { gid: productGid, shop },
    });
    if (product) {
      return safeJsonParse(product.variantIds, []);
    }
    return null;
  } catch (error) {
    logger.error("Error checking product in DB", { err: error, productGid });
    return null;
  }
}
