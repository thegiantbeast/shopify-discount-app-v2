export function computeDiscountType(discountId) {
  return discountId.includes("DiscountCodeNode") ? "CODE" : "AUTO";
}

export function getTemporalBounds(discountData) {
  let startsAt = discountData?.startsAt ? new Date(discountData.startsAt) : new Date();
  let endsAt = discountData?.endsAt ? new Date(discountData.endsAt) : null;
  if (Number.isNaN(startsAt?.valueOf?.())) {
    startsAt = new Date();
  }
  if (endsAt && Number.isNaN(endsAt?.valueOf?.())) {
    endsAt = null;
  }
  return { startsAt, endsAt };
}

export function isExpiredStatus(status) {
  return status === "EXPIRED";
}

export function isPastEndDate(endsAt, now = new Date()) {
  return endsAt && now > endsAt;
}
