import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import { useState, useCallback, useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Select,
  Checkbox,
  Banner,
  Button,
  BlockStack,
  InlineStack,
  FormLayout,
  Box,
  Divider,
} from "@shopify/polaris";

const NAMESPACE = "discount_app";

const CUSTOMIZE_DEFAULTS = {
  automatic_badge_text: "Sale {amount} OFF",
  coupon_badge_text: "Save {amount} with coupon",
  pp_automatic_badge_text: "Sale {amount} OFF",
  pp_coupon_text: "Coupon:",
  pp_coupon_apply_label: "Apply {amount} discount",
  pp_coupon_applied_label: "{amount} off coupon applied",
  auto_apply_coupons: false,
  discount_terms_template:
    "This discount may not combine with other promotions. Please confirm final price at checkout\nValid on selected products only\nWe reserve the right to modify or cancel this offer at any time",
};

const ADVANCED_DEFAULTS = {
  use_auto_detect_selectors: true,
  use_card_price_selector: false,
  user_card_price_selector: "",
  use_card_container_selector: false,
  user_card_container_selector: "",
  use_form_container_selector: false,
  user_form_container_selector: "",
  use_form_price_selector: false,
  user_form_price_selector: "",
  use_variant_input_selector: false,
  user_variant_input_selector: "",
};

const ALL_SETTING_KEYS = [
  ...Object.keys(CUSTOMIZE_DEFAULTS),
  ...Object.keys(ADVANCED_DEFAULTS),
];

function buildFetchQuery() {
  const metafieldAliases = ALL_SETTING_KEYS.map(
    (key) =>
      `${key}: metafield(namespace: "${NAMESPACE}", key: "${key}") { value }`,
  ).join("\n      ");

  return `
    query GetAllSettings {
      shop {
        id
        ${metafieldAliases}
      }
    }
  `;
}

function parseSettingValue(key, rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return CUSTOMIZE_DEFAULTS[key] ?? ADVANCED_DEFAULTS[key] ?? "";
  }

  if (key === "auto_apply_coupons" || key.startsWith("use_")) {
    return rawValue === "true";
  }

  return rawValue;
}

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const prisma = (await import("../db.server.js")).default;
  const { getShopTierInfo } = await import(
    "../utils/tier-manager.server.js"
  );

  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  const tierInfo = await getShopTierInfo(shopDomain, prisma);

  // Fetch all settings in one query
  const response = await admin.graphql(buildFetchQuery());
  const data = await response.json();
  const shopData = data.data?.shop || {};

  const customize = {};
  for (const key of Object.keys(CUSTOMIZE_DEFAULTS)) {
    customize[key] = parseSettingValue(key, shopData[key]?.value ?? null);
  }

  // Force auto_apply_coupons to false on FREE tier
  if (tierInfo.tier === "FREE") {
    customize.auto_apply_coupons = false;
  }

  const advanced = {};
  for (const key of Object.keys(ADVANCED_DEFAULTS)) {
    advanced[key] = parseSettingValue(key, shopData[key]?.value ?? null);
  }

  return json({
    customize,
    advanced,
    tierInfo,
  });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { createLogger } = await import("../utils/logger.server.js");
  const prisma = (await import("../db.server.js")).default;
  const { getShopTierInfo } = await import(
    "../utils/tier-manager.server.js"
  );

  const logger = createLogger("SettingsPage");
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  const formData = await request.formData();
  const settingsJson = formData.get("settings");

  if (!settingsJson) {
    return json({ error: "No settings provided" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = JSON.parse(settingsJson);
  } catch {
    return json({ error: "Invalid settings format" }, { status: 400 });
  }

  const { customize = {}, advanced = {} } = parsed;

  // Force auto_apply_coupons to false on FREE tier
  const tierInfo = await getShopTierInfo(shopDomain, prisma);
  if (tierInfo.tier === "FREE") {
    customize.auto_apply_coupons = false;
  }

  try {
    // Get shop owner ID for metafieldsSet
    const shopResponse = await admin.graphql(`query { shop { id } }`);
    const shopData = await shopResponse.json();
    const ownerId = shopData.data?.shop?.id;

    if (!ownerId) {
      return json({ error: "Could not resolve shop ID" }, { status: 500 });
    }

    // Save customize settings
    const customizeMetafields = Object.entries(customize).map(
      ([key, value]) => {
        let type = "single_line_text_field";
        let metaValue = String(value);

        if (key === "auto_apply_coupons") {
          type = "boolean";
          metaValue = value ? "true" : "false";
        } else if (key === "discount_terms_template") {
          type = "multi_line_text_field";
        }

        return { namespace: NAMESPACE, key, value: metaValue, type, ownerId };
      },
    );

    const customizeResponse = await admin.graphql(
      `
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key value }
          userErrors { field message }
        }
      }
    `,
      { variables: { metafields: customizeMetafields } },
    );
    const customizeResult = await customizeResponse.json();
    const customizeErrors =
      customizeResult.data?.metafieldsSet?.userErrors || [];

    // Save advanced settings
    const advancedMetafields = Object.entries(advanced)
      .filter(([key, value]) => {
        // Skip empty string values for custom selector fields
        if (key.startsWith("user_") && (!value || !String(value).trim())) {
          return false;
        }
        return true;
      })
      .map(([key, value]) => {
        let type = "single_line_text_field";
        let metaValue = String(value);

        if (key.startsWith("use_")) {
          type = "boolean";
          metaValue = value ? "true" : "false";
        }

        return { namespace: NAMESPACE, key, value: metaValue, type, ownerId };
      });

    let advancedErrors = [];
    if (advancedMetafields.length > 0) {
      const advancedResponse = await admin.graphql(
        `
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key value }
            userErrors { field message }
          }
        }
      `,
        { variables: { metafields: advancedMetafields } },
      );
      const advancedResult = await advancedResponse.json();
      advancedErrors = advancedResult.data?.metafieldsSet?.userErrors || [];
    }

    const allErrors = [...customizeErrors, ...advancedErrors];
    if (allErrors.length > 0) {
      logger.warn(
        "Metafield save had user errors",
        { shop: shopDomain, errors: allErrors },
      );
      return json({
        success: false,
        error: allErrors.map((e) => e.message).join(", "),
      });
    }

    logger.info("Settings saved successfully", { shop: shopDomain });
    return json({ success: true });
  } catch (error) {
    logger.error("Failed to save settings", { err: error, shop: shopDomain });
    return json({ error: "Failed to save settings" }, { status: 500 });
  }
};

const SELECTOR_FIELDS = [
  {
    label: "Card Price Selector",
    useKey: "use_card_price_selector",
    valueKey: "user_card_price_selector",
    section: "Product Cards",
  },
  {
    label: "Card Container Selector",
    useKey: "use_card_container_selector",
    valueKey: "user_card_container_selector",
    section: "Product Cards",
  },
  {
    label: "Form Container Selector",
    useKey: "use_form_container_selector",
    valueKey: "user_form_container_selector",
    section: "Product Forms",
  },
  {
    label: "Form Price Selector",
    useKey: "use_form_price_selector",
    valueKey: "user_form_price_selector",
    section: "Product Forms",
  },
  {
    label: "Variant Input Selector",
    useKey: "use_variant_input_selector",
    valueKey: "user_variant_input_selector",
    section: "Product Forms",
  },
];

function SelectorField({
  label,
  useCustom,
  customValue,
  onUseChange,
  onValueChange,
}) {
  const selectValue = useCustom ? "custom" : "auto";

  return (
    <BlockStack gap="200">
      <Select
        label={label}
        options={[
          { label: "Auto-detect", value: "auto" },
          { label: "Custom", value: "custom" },
        ]}
        value={selectValue}
        onChange={(v) => onUseChange(v === "custom")}
      />
      {useCustom && (
        <Box paddingInlineStart="400">
          <TextField
            label="CSS selector"
            labelHidden
            value={customValue}
            onChange={onValueChange}
            placeholder=".price__container"
            autoComplete="off"
          />
        </Box>
      )}
    </BlockStack>
  );
}

export default function SettingsPage() {
  const { customize: initialCustomize, advanced: initialAdvanced, tierInfo } =
    useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();

  const [customize, setCustomize] = useState(initialCustomize);
  const [advanced, setAdvanced] = useState(initialAdvanced);

  const isFreeTier = tierInfo.tier === "FREE";

  const isDirty = useMemo(() => {
    return (
      JSON.stringify(customize) !== JSON.stringify(initialCustomize) ||
      JSON.stringify(advanced) !== JSON.stringify(initialAdvanced)
    );
  }, [customize, advanced, initialCustomize, initialAdvanced]);

  const handleCustomizeChange = useCallback((key, value) => {
    setCustomize((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleAdvancedChange = useCallback((key, value) => {
    setAdvanced((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("settings", JSON.stringify({ customize, advanced }));
    submit(formData, { method: "post" });
  }, [customize, advanced, submit]);

  const masterAutoDetect = advanced.use_auto_detect_selectors;

  return (
    <Page
      title="Settings"
      primaryAction={{
        content: "Save",
        onAction: handleSave,
        disabled: !isDirty,
      }}
    >
      <BlockStack gap="500">
        {actionData?.success && (
          <Banner title="Settings saved" tone="success" />
        )}
        {actionData?.error && (
          <Banner title="Error saving settings" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        <Layout>
          {/* Product Cards Section */}
          <Layout.AnnotatedSection
            title="Product Cards"
            description="Badge text shown on product cards in collections and grids."
          >
            <Card>
              <FormLayout>
                <TextField
                  label="Automatic badge text"
                  value={customize.automatic_badge_text}
                  onChange={(v) =>
                    handleCustomizeChange("automatic_badge_text", v)
                  }
                  helpText="Use {amount} for the discount value"
                  autoComplete="off"
                />
                <TextField
                  label="Coupon badge text"
                  value={customize.coupon_badge_text}
                  onChange={(v) =>
                    handleCustomizeChange("coupon_badge_text", v)
                  }
                  helpText="Use {amount} for the discount value"
                  autoComplete="off"
                />
              </FormLayout>
            </Card>
          </Layout.AnnotatedSection>

          {/* Product Forms Section */}
          <Layout.AnnotatedSection
            title="Product Forms"
            description="Badge text and coupon settings for product pages."
          >
            <Card>
              <FormLayout>
                <TextField
                  label="Automatic badge text"
                  value={customize.pp_automatic_badge_text}
                  onChange={(v) =>
                    handleCustomizeChange("pp_automatic_badge_text", v)
                  }
                  helpText="Use {amount} for the discount value"
                  autoComplete="off"
                />
                <TextField
                  label="Coupon label"
                  value={customize.pp_coupon_text}
                  onChange={(v) =>
                    handleCustomizeChange("pp_coupon_text", v)
                  }
                  autoComplete="off"
                />
                <TextField
                  label="Coupon apply label"
                  value={customize.pp_coupon_apply_label}
                  onChange={(v) =>
                    handleCustomizeChange("pp_coupon_apply_label", v)
                  }
                  helpText="Use {amount} for the discount value"
                  autoComplete="off"
                />
                <TextField
                  label="Coupon applied label"
                  value={customize.pp_coupon_applied_label}
                  onChange={(v) =>
                    handleCustomizeChange("pp_coupon_applied_label", v)
                  }
                  helpText="Use {amount} for the discount value"
                  autoComplete="off"
                />

                <Divider />

                <Checkbox
                  label="Auto-apply coupons"
                  checked={customize.auto_apply_coupons}
                  onChange={(v) =>
                    handleCustomizeChange("auto_apply_coupons", v)
                  }
                  disabled={isFreeTier}
                  helpText={
                    isFreeTier
                      ? "Available on the Basic plan and above."
                      : "Automatically apply coupon discounts on product pages."
                  }
                />
                {isFreeTier && (
                  <InlineStack>
                    <Button url="/app/pricing" variant="plain" size="slim">
                      Upgrade to enable
                    </Button>
                  </InlineStack>
                )}

                <Divider />

                <TextField
                  label="Discount terms template"
                  value={customize.discount_terms_template}
                  onChange={(v) =>
                    handleCustomizeChange("discount_terms_template", v)
                  }
                  multiline={4}
                  helpText="Each line becomes a bullet point in the terms list"
                  autoComplete="off"
                />
              </FormLayout>
            </Card>
          </Layout.AnnotatedSection>

          {/* Advanced Theme Selectors */}
          <Layout.AnnotatedSection
            title="Advanced Theme Selectors"
            description="Override auto-detected CSS selectors for custom themes."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Use auto-detect for all selectors"
                  checked={masterAutoDetect}
                  onChange={(v) =>
                    handleAdvancedChange("use_auto_detect_selectors", v)
                  }
                  helpText="When enabled, the app uses built-in theme detection. Disable to set custom CSS selectors."
                />

                {!masterAutoDetect && (
                  <>
                    <Divider />

                    {["Product Cards", "Product Forms"].map((section) => (
                      <BlockStack gap="400" key={section}>
                        <Text as="h3" variant="headingSm">
                          {section}
                        </Text>
                        {SELECTOR_FIELDS.filter(
                          (f) => f.section === section,
                        ).map((field) => (
                          <SelectorField
                            key={field.useKey}
                            label={field.label}
                            useCustom={advanced[field.useKey]}
                            customValue={advanced[field.valueKey]}
                            onUseChange={(v) =>
                              handleAdvancedChange(field.useKey, v)
                            }
                            onValueChange={(v) =>
                              handleAdvancedChange(field.valueKey, v)
                            }
                          />
                        ))}
                      </BlockStack>
                    ))}
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
