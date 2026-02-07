import { logger } from './logger.js';

/**
 * Gets current variant information from container
 * @param {HTMLElement} container - Container element to search within
 * @param {string} variantInputSelector - Selector for variant input
 * @returns {Object} Object with variantId and inputElement
 */
export function getCurrentVariantInfo(container, variantInputSelector) {
  try {
    // Try to find variant input within container
    let variantInput = container.querySelector(variantInputSelector);

    // Fallback: try closest section
    if (!variantInput) {
      const section = container.closest('[id^="shopify-section-"]');
      if (section) {
        variantInput = section.querySelector(variantInputSelector);
      }
    }

    // Fallback: common variant input patterns
    if (!variantInput) {
      const selectors = [
        'input[name="id"]',
        'select[name="id"]',
        '[data-variant-id]',
        '.product-variant-id'
      ];

      for (const selector of selectors) {
        variantInput = container.querySelector(selector);
        if (variantInput) break;

        const section = container.closest('[id^="shopify-section-"]');
        if (section) {
          variantInput = section.querySelector(selector);
          if (variantInput) break;
        }
      }
    }

    if (!variantInput) {
      logger.warn({ container: container.id || container.className }, 'No variant input found');
      return { variantId: null, inputElement: null };
    }

    // Extract variant ID
    let variantId = null;
    if (variantInput.tagName === 'INPUT' || variantInput.tagName === 'SELECT') {
      variantId = variantInput.value;
    } else if (variantInput.dataset.variantId) {
      variantId = variantInput.dataset.variantId;
    }

    logger.debug({ variantId, selector: variantInputSelector }, 'Found variant info');
    return { variantId, inputElement: variantInput };

  } catch (error) {
    logger.error({ err: error, container: container?.id }, 'Failed to get variant info');
    return { variantId: null, inputElement: null };
  }
}

/**
 * Gets current selling plan information from container
 * @param {HTMLElement} container - Container element to search within
 * @returns {Object} Object with sellingPlanId and inputElement
 */
export function getCurrentSellingPlanInfo(container) {
  try {
    // Find selling plan input/select
    const selectors = [
      'input[name="selling_plan"]',
      'select[name="selling_plan"]',
      '[data-selling-plan-id]'
    ];

    let planInput = null;
    for (const selector of selectors) {
      planInput = container.querySelector(selector);
      if (planInput) break;

      // Try closest section
      const section = container.closest('[id^="shopify-section-"]');
      if (section) {
        planInput = section.querySelector(selector);
        if (planInput) break;
      }
    }

    if (!planInput) {
      logger.debug({ container: container.id || container.className }, 'No selling plan input found');
      return { sellingPlanId: null, inputElement: null };
    }

    // Extract selling plan ID
    let sellingPlanId = null;
    if (planInput.tagName === 'INPUT' || planInput.tagName === 'SELECT') {
      sellingPlanId = planInput.value;
    } else if (planInput.dataset.sellingPlanId) {
      sellingPlanId = planInput.dataset.sellingPlanId;
    }

    // Empty string means one-time purchase
    if (sellingPlanId === '') {
      sellingPlanId = null;
    }

    logger.debug({ sellingPlanId }, 'Found selling plan info');
    return { sellingPlanId, inputElement: planInput };

  } catch (error) {
    logger.error({ err: error, container: container?.id }, 'Failed to get selling plan info');
    return { sellingPlanId: null, inputElement: null };
  }
}

/**
 * Sets up variant detection with multiple strategies
 * @param {HTMLElement} rootElement - Root element to attach listeners to
 * @param {string} variantInputSelector - Selector for variant input
 * @param {Function} onVariantChange - Callback for variant changes (variantId)
 * @param {Function} onSellingPlanChange - Callback for selling plan changes (sellingPlanId)
 */
export function setupVariantDetection(
  rootElement,
  variantInputSelector,
  onVariantChange,
  onSellingPlanChange
) {
  try {
    logger.info('Setting up variant detection');

    const trackedElements = new WeakSet();
    let lastVariantId = null;
    let lastSellingPlanId = null;

    // Helper: notify variant change if different
    const notifyVariantChange = (variantId, source) => {
      if (variantId && variantId !== lastVariantId) {
        lastVariantId = variantId;
        logger.debug({ variantId, source }, 'Variant changed');
        if (onVariantChange) {
          onVariantChange(variantId);
        }
      }
    };

    // Helper: notify selling plan change if different
    const notifySellingPlanChange = (sellingPlanId, source) => {
      if (sellingPlanId !== lastSellingPlanId) {
        lastSellingPlanId = sellingPlanId;
        logger.debug({ sellingPlanId, source }, 'Selling plan changed');
        if (onSellingPlanChange) {
          onSellingPlanChange(sellingPlanId);
        }
      }
    };

    // Strategy 1: Cart form detection
    const setupCartFormDetection = () => {
      try {
        const cartForms = rootElement.querySelectorAll('form[action*="cart/add"], form[action*="/cart/add"]');

        cartForms.forEach(form => {
          if (trackedElements.has(form)) return;
          trackedElements.add(form);

          // Find variant input
          const variantInput = form.querySelector(variantInputSelector) ||
                              form.querySelector('input[name="id"]') ||
                              form.querySelector('select[name="id"]');

          if (variantInput) {
            // Listen to change and input events
            variantInput.addEventListener('change', (e) => {
              notifyVariantChange(e.target.value, 'cart-form-change');
            });

            variantInput.addEventListener('input', (e) => {
              notifyVariantChange(e.target.value, 'cart-form-input');
            });

            logger.debug('Attached cart form variant listener');
          }

          // Find selling plan input
          const planInput = form.querySelector('input[name="selling_plan"]') ||
                           form.querySelector('select[name="selling_plan"]');

          if (planInput) {
            planInput.addEventListener('change', (e) => {
              notifySellingPlanChange(e.target.value || null, 'cart-form-plan-change');
            });

            planInput.addEventListener('input', (e) => {
              notifySellingPlanChange(e.target.value || null, 'cart-form-plan-input');
            });

            logger.debug('Attached cart form selling plan listener');
          }
        });
      } catch (error) {
        logger.error({ err: error }, 'Cart form detection failed');
      }
    };

    // Strategy 2: MutationObserver on variant input
    const setupMutationObserver = () => {
      try {
        const variantInputs = rootElement.querySelectorAll(variantInputSelector);

        variantInputs.forEach(input => {
          if (trackedElements.has(input)) return;
          trackedElements.add(input);

          const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
              if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
                const variantId = input.value;
                notifyVariantChange(variantId, 'mutation-observer');
              }
            });
          });

          observer.observe(input, {
            attributes: true,
            attributeFilter: ['value']
          });

          logger.debug('Attached mutation observer to variant input');
        });
      } catch (error) {
        logger.error({ err: error }, 'Mutation observer setup failed');
      }
    };

    // Strategy 3: Event delegation for common patterns
    const setupEventDelegation = () => {
      try {
        // Variant input changes
        rootElement.addEventListener('change', (e) => {
          const target = e.target;

          // Variant input
          if (target.matches('input[name="id"], select[name="id"]')) {
            notifyVariantChange(target.value, 'event-delegation-change');
          }

          // Selling plan input
          if (target.matches('input[name="selling_plan"], select[name="selling_plan"]')) {
            notifySellingPlanChange(target.value || null, 'event-delegation-plan-change');
          }
        }, true);

        rootElement.addEventListener('input', (e) => {
          const target = e.target;

          // Variant input
          if (target.matches('input[name="id"]')) {
            notifyVariantChange(target.value, 'event-delegation-input');
          }

          // Selling plan input
          if (target.matches('input[name="selling_plan"]')) {
            notifySellingPlanChange(target.value || null, 'event-delegation-plan-input');
          }
        }, true);

        logger.debug('Attached event delegation listeners');
      } catch (error) {
        logger.error({ err: error }, 'Event delegation setup failed');
      }
    };

    // Strategy 4: Custom theme events
    const setupCustomEvents = () => {
      try {
        const customEventNames = [
          'variant:change',
          'variant:changed',
          'product:variant:changed',
          'option:change',
          'variantChange',
          'shopify:variant:change'
        ];

        customEventNames.forEach(eventName => {
          rootElement.addEventListener(eventName, (e) => {
            const variantId = e.detail?.variant?.id ||
                            e.detail?.variantId ||
                            e.detail?.id;

            if (variantId) {
              notifyVariantChange(String(variantId), `custom-event-${eventName}`);
            }
          });
        });

        logger.debug('Attached custom event listeners');
      } catch (error) {
        logger.error({ err: error }, 'Custom events setup failed');
      }
    };

    // Strategy 5: URL parameter monitoring (optional)
    const setupUrlMonitoring = () => {
      try {
        const checkUrlVariant = () => {
          const params = new URLSearchParams(window.location.search);
          const variantId = params.get('variant');
          if (variantId) {
            notifyVariantChange(variantId, 'url-parameter');
          }
        };

        // Check on popstate (back/forward navigation)
        window.addEventListener('popstate', checkUrlVariant);

        // Initial check
        checkUrlVariant();

        logger.debug('Attached URL monitoring');
      } catch (error) {
        logger.error({ err: error }, 'URL monitoring setup failed');
      }
    };

    // Initialize all detection strategies
    setupCartFormDetection();
    setupMutationObserver();
    setupEventDelegation();
    setupCustomEvents();
    setupUrlMonitoring();

    // Set initial values
    const initialVariantInfo = getCurrentVariantInfo(rootElement, variantInputSelector);
    if (initialVariantInfo.variantId) {
      lastVariantId = initialVariantInfo.variantId;
    }

    const initialPlanInfo = getCurrentSellingPlanInfo(rootElement);
    if (initialPlanInfo.sellingPlanId !== undefined) {
      lastSellingPlanId = initialPlanInfo.sellingPlanId;
    }

    logger.info({
      initialVariantId: lastVariantId,
      initialSellingPlanId: lastSellingPlanId
    }, 'Variant detection setup complete');

  } catch (error) {
    logger.error({ err: error }, 'Failed to setup variant detection');
  }
}
