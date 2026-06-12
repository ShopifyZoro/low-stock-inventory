(() => {
  'use strict';

  if (window.LowStockCounter) {
    window.LowStockCounter.refresh();
    return;
  }

  const instances = new Map();
  const selector = '[data-inventory-counter]';
  const variantEvents = ['variant:change', 'product:variant-change', 'variantChanged', 'shopify:variant:change'];

  const parseVariants = (root) => {
    const source = root.querySelector('[data-inventory-variants]');
    if (!source) return [];

    try {
      return JSON.parse(source.textContent || '[]');
    } catch (error) {
      console.warn('Low stock counter could not parse variant inventory data.', error);
      return [];
    }
  };

  const selectedVariantId = (root, event) => {
    const detail = event && event.detail;
    const eventVariant = detail && (detail.variant || detail);
    if (eventVariant && eventVariant.id) return String(eventVariant.id);

    const section = root.closest('.shopify-section') || root.closest('section') || document;
    const form = section.querySelector('form[action*="/cart/add"]') || document.querySelector('form[action*="/cart/add"]');
    const idInput = form && form.querySelector('[name="id"]');
    const urlVariant = new URLSearchParams(window.location.search).get('variant');

    return String((idInput && idInput.value) || urlVariant || root.dataset.initialVariantId || '');
  };

  const createInstance = (root) => {
    if (instances.has(root)) return instances.get(root);

    const variants = parseVariants(root);
    const threshold = Math.max(1, Number(root.dataset.threshold) || 10);
    const messageTemplate = root.dataset.message || 'Hurry! Only [count] items left in stock!';
    const message = root.querySelector('[data-inventory-message]');
    const progress = root.querySelector('[data-inventory-progress]');
    const fill = root.querySelector('[data-inventory-fill]');
    const simulationMinimum = Math.min(threshold, Math.max(0, Number(root.dataset.simulationMinimum) || 3));
    const simulationStart = Math.max(simulationMinimum, Math.min(threshold, Number(root.dataset.simulationStart) || 8));
    const simulationInterval = Math.max(3000, Number(root.dataset.simulationInterval) || 12000);
    const productKey = root.dataset.productId || window.location.pathname;
    const sessionKey = `low-stock-counter:${productKey}`;
    let timer;

    const render = (count, available) => {
      const inventory = Math.max(0, Number(count) || 0);
      const visible = Boolean(available) && inventory <= threshold;
      root.hidden = !visible;
      root.classList.toggle('inventory-counter--hidden', !visible);
      message.textContent = messageTemplate.split('[count]').join(String(inventory));
      progress.setAttribute('aria-valuenow', String(inventory));
      fill.style.width = `${Math.min(100, (inventory / threshold) * 100)}%`;
    };

    const stopSimulation = () => {
      if (timer) window.clearInterval(timer);
      timer = undefined;
    };

    const readSimulation = (variantId) => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(sessionKey) || '{}');
        const count = Number(saved[variantId]);
        return Number.isFinite(count) && count >= simulationMinimum && count <= simulationStart ? count : simulationStart;
      } catch (_error) {
        return simulationStart;
      }
    };

    const saveSimulation = (variantId, count) => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(sessionKey) || '{}');
        saved[variantId] = count;
        sessionStorage.setItem(sessionKey, JSON.stringify(saved));
      } catch (_error) {
        // Storage can be unavailable in privacy-restricted browser contexts.
      }
    };

    const simulate = (variant) => {
      stopSimulation();
      let count = readSimulation(String(variant.id));
      render(count, variant.available);
      saveSimulation(String(variant.id), count);

      timer = window.setInterval(() => {
        if (count <= simulationMinimum) return stopSimulation();
        count -= 1;
        saveSimulation(String(variant.id), count);
        render(count, variant.available);
      }, simulationInterval);
    };

    const update = (event) => {
      const id = selectedVariantId(root, event);
      const variant = variants.find((item) => String(item.id) === id) || variants[0];

      if (!variant) {
        root.hidden = true;
        return;
      }

      const tracked = Boolean(variant.inventory_management);
      const infinite = variant.inventory_policy === 'continue';
      const inventory = Number(variant.inventory_quantity);

      if (!tracked || infinite || !Number.isFinite(inventory)) {
        simulate(variant);
      } else {
        stopSimulation();
        render(inventory, variant.available);
      }
    };

    const instance = { update, destroy: stopSimulation };
    instances.set(root, instance);
    update();
    return instance;
  };

  const refresh = () => {
    instances.forEach((instance, root) => {
      if (!root.isConnected) {
        instance.destroy();
        instances.delete(root);
      }
    });

    document.querySelectorAll(selector).forEach(createInstance);
  };

  const updateAll = (event) => instances.forEach((instance) => instance.update(event));

  variantEvents.forEach((eventName) => document.addEventListener(eventName, updateAll));

  document.addEventListener('change', (event) => {
    if (event.target.closest('variant-selects, variant-radios, [data-variant-selector], form[action*="/cart/add"]')) {
      window.setTimeout(() => updateAll(event), 0);
    }
  });

  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });

  window.LowStockCounter = { refresh, updateAll };
  refresh();
})();
