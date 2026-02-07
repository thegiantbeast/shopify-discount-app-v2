/**
 * Complete discount fragment handling ALL 8 Shopify discount types.
 * Each type queries only fields that exist on that type.
 */
export const DISCOUNT_FRAGMENT = `
  __typename
  ... on DiscountAutomaticBasic {
    title
    status
    startsAt
    endsAt
    summary
    discountClass
    discountClasses
    context { __typename }
    minimumRequirement {
      ... on DiscountMinimumSubtotal {
        greaterThanOrEqualToSubtotal { amount currencyCode }
      }
      ... on DiscountMinimumQuantity {
        greaterThanOrEqualToQuantity
      }
    }
    customerGets {
      appliesOnOneTimePurchase
      appliesOnSubscription
      items {
        ... on DiscountCollections {
          collections(first: 100) { nodes { id } }
        }
        ... on DiscountProducts {
          products(first: 100) { nodes { id } }
          productVariants(first: 100) { nodes { id } }
        }
      }
      value {
        ... on DiscountAmount { amount { amount currencyCode } }
        ... on DiscountPercentage { percentage }
      }
    }
  }
  ... on DiscountCodeBasic {
    title
    status
    startsAt
    endsAt
    summary
    discountClass
    discountClasses
    codesCount { count }
    codes(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes { code id }
    }
    context { __typename }
    minimumRequirement {
      ... on DiscountMinimumSubtotal {
        greaterThanOrEqualToSubtotal { amount currencyCode }
      }
      ... on DiscountMinimumQuantity {
        greaterThanOrEqualToQuantity
      }
    }
    customerGets {
      appliesOnOneTimePurchase
      appliesOnSubscription
      items {
        ... on DiscountCollections {
          collections(first: 100) { nodes { id } }
        }
        ... on DiscountProducts {
          products(first: 100) { nodes { id } }
          productVariants(first: 100) { nodes { id } }
        }
      }
      value {
        ... on DiscountAmount { amount { amount currencyCode } }
        ... on DiscountPercentage { percentage }
      }
    }
  }
  ... on DiscountAutomaticBxgy {
    title
    status
    startsAt
    endsAt
    summary
    discountClass
    discountClasses
    context { __typename }
    customerGets {
      appliesOnOneTimePurchase
      appliesOnSubscription
      items {
        ... on DiscountCollections {
          collections(first: 100) { nodes { id } }
        }
        ... on DiscountProducts {
          products(first: 100) { nodes { id } }
          productVariants(first: 100) { nodes { id } }
        }
      }
      value {
        ... on DiscountAmount { amount { amount currencyCode } }
        ... on DiscountPercentage { percentage }
      }
    }
  }
  ... on DiscountCodeBxgy {
    title
    status
    startsAt
    endsAt
    summary
    discountClass
    discountClasses
    codesCount { count }
    codes(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes { code id }
    }
    context { __typename }
    customerGets {
      appliesOnOneTimePurchase
      appliesOnSubscription
      items {
        ... on DiscountCollections {
          collections(first: 100) { nodes { id } }
        }
        ... on DiscountProducts {
          products(first: 100) { nodes { id } }
          productVariants(first: 100) { nodes { id } }
        }
      }
      value {
        ... on DiscountAmount { amount { amount currencyCode } }
        ... on DiscountPercentage { percentage }
      }
    }
  }
  ... on DiscountAutomaticFreeShipping {
    title
    status
    startsAt
    endsAt
    summary
    discountClass
    discountClasses
    context { __typename }
    minimumRequirement {
      ... on DiscountMinimumSubtotal {
        greaterThanOrEqualToSubtotal { amount currencyCode }
      }
      ... on DiscountMinimumQuantity {
        greaterThanOrEqualToQuantity
      }
    }
  }
  ... on DiscountCodeFreeShipping {
    title
    status
    startsAt
    endsAt
    summary
    discountClass
    discountClasses
    codesCount { count }
    codes(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes { code id }
    }
    context { __typename }
    minimumRequirement {
      ... on DiscountMinimumSubtotal {
        greaterThanOrEqualToSubtotal { amount currencyCode }
      }
      ... on DiscountMinimumQuantity {
        greaterThanOrEqualToQuantity
      }
    }
  }
  ... on DiscountAutomaticApp {
    title
    status
    startsAt
    endsAt
    discountClass
    discountClasses
    context { __typename }
  }
  ... on DiscountCodeApp {
    title
    status
    startsAt
    endsAt
    discountClass
    discountClasses
    codesCount { count }
    codes(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes { code id }
    }
    context { __typename }
  }
`;

/**
 * Single discount node query — used by webhooks (create/update).
 */
export const GET_DISCOUNT_NODE_QUERY = `
  query GetDiscountNode($id: ID!) {
    discountNode(id: $id) {
      id
      discount {
        ${DISCOUNT_FRAGMENT}
      }
    }
  }
`;

/**
 * Paginated all-discounts query — used by reprocessAllDiscountsForShop.
 * No status/class filter — fetches ALL discounts so pipeline can evaluate each.
 */
export const GET_ALL_DISCOUNTS_QUERY = `
  query getAllDiscounts($after: String) {
    discountNodes(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          discount {
            ${DISCOUNT_FRAGMENT}
          }
        }
      }
    }
  }
`;

/**
 * Initial import query — lightweight bulk fetch with server-side filters.
 * Only fetches active product discounts with summary-level fields.
 */
export const GET_INITIAL_DISCOUNTS_QUERY = `
  query getInitialDiscounts($after: String) {
    discountNodes(first: 250, after: $after, query: "status:active AND discount_class:product") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          discount {
            __typename
            ... on DiscountCodeBasic {
              startsAt
              endsAt
              summary
              context { __typename }
              minimumRequirement {
                ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
                ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
              }
              customerSelection { __typename }
            }
            ... on DiscountAutomaticBasic {
              startsAt
              endsAt
              summary
              context { __typename }
              minimumRequirement {
                ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
                ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Query to fetch discount codes with pagination (for discounts with >100 codes).
 */
export const GET_DISCOUNT_CODES_QUERY = `
  query GetDiscountCodes($id: ID!, $after: String) {
    codeDiscountNode(id: $id) {
      codeDiscount {
        ... on DiscountCodeBasic {
          codes(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { code id }
          }
        }
        ... on DiscountCodeBxgy {
          codes(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { code id }
          }
        }
        ... on DiscountCodeFreeShipping {
          codes(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { code id }
          }
        }
        ... on DiscountCodeApp {
          codes(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { code id }
          }
        }
      }
    }
  }
`;
