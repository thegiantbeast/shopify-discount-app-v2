import { createLogger } from "../logger.server.js";

const logger = createLogger("GraphQLClient");

const MAX_RETRIES = 3;
const THROTTLE_THRESHOLD = 100;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10000;

function calculateBackoff(attempt) {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = Math.random() * delay * 0.1;
  return delay + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract throttle status from a Shopify GraphQL response.
 * Shopify includes this in `extensions.cost.throttleStatus`.
 */
function extractThrottleStatus(responseData) {
  return responseData?.extensions?.cost?.throttleStatus ?? null;
}

/**
 * Check if the response indicates a throttled request.
 */
function isThrottled(responseData) {
  if (responseData?.errors) {
    return responseData.errors.some(
      (e) => e.extensions?.code === "THROTTLED" || e.message?.includes("Throttled")
    );
  }
  return false;
}

/**
 * Rate-limit-aware GraphQL query wrapper.
 * Reads throttleStatus from every response, backs off when near limits,
 * and retries throttled requests with exponential backoff.
 *
 * @param {object} admin - Shopify admin GraphQL client
 * @param {string} queryString - The GraphQL query string
 * @param {object} [variables={}] - Query variables
 * @returns {Promise<{data: object, throttleStatus: object|null}>}
 */
export async function graphqlQuery(admin, queryString, variables = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await admin.graphql(queryString, { variables });
      const responseJson = await response.json();
      const responseData = responseJson.data ? responseJson : { data: responseJson };

      const throttleStatus = extractThrottleStatus(responseData);

      if (throttleStatus) {
        const available = throttleStatus.currentlyAvailable;
        if (available < THROTTLE_THRESHOLD) {
          const restoreRate = throttleStatus.restoreRate || 50;
          const deficit = THROTTLE_THRESHOLD - available;
          const waitMs = Math.ceil((deficit / restoreRate) * 1000);
          logger.warn(
            { available, restoreRate, waitMs, attempt },
            "GraphQL rate limit approaching, backing off"
          );
          await sleep(Math.min(waitMs, MAX_DELAY_MS));
        }
      }

      if (isThrottled(responseData)) {
        if (attempt < MAX_RETRIES) {
          const delay = calculateBackoff(attempt);
          logger.warn(
            { attempt, delay, errors: responseData.errors?.map((e) => e.message) },
            "GraphQL request throttled, retrying"
          );
          await sleep(delay);
          continue;
        }
        logger.error(
          { attempt, errors: responseData.errors?.map((e) => e.message) },
          "GraphQL request throttled after max retries"
        );
        throw new Error("GraphQL request throttled after max retries");
      }

      if (!response.ok || responseData.errors) {
        const errors = responseData.errors || responseData.data?.errors;
        if (errors && attempt < MAX_RETRIES) {
          const isRetryable = errors.some(
            (e) =>
              e.extensions?.code === "INTERNAL_SERVER_ERROR" ||
              e.message?.includes("temporarily unavailable")
          );
          if (isRetryable) {
            const delay = calculateBackoff(attempt);
            logger.warn(
              { attempt, delay, errors: errors.map((e) => e.message) },
              "GraphQL transient error, retrying"
            );
            await sleep(delay);
            continue;
          }
        }

        if (errors) {
          logger.error(
            { errors: errors.map((e) => e.message) },
            "GraphQL query returned errors"
          );
        }
      }

      return {
        data: responseData.data || responseData,
        errors: responseData.errors || null,
        throttleStatus,
      };
    } catch (error) {
      lastError = error;
      if (error.message?.includes("throttled") || error.message?.includes("429")) {
        if (attempt < MAX_RETRIES) {
          const delay = calculateBackoff(attempt);
          logger.warn(
            { err: error, attempt, delay },
            "GraphQL request failed with throttle error, retrying"
          );
          await sleep(delay);
          continue;
        }
      }

      if (attempt < MAX_RETRIES) {
        const delay = calculateBackoff(attempt);
        logger.warn(
          { err: error, attempt, delay },
          "GraphQL request failed, retrying"
        );
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error("GraphQL request failed after max retries");
}
