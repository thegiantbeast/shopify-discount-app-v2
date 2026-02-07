/**
 * Client-side logger for Discount Display Pro theme extension
 * Exposed as window["display-discounts-pro"].logger
 */

import _ns from './namespace.js';

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const CATEGORIES = {
  Forms: 'Forms',
  Cards: 'Cards',
  General: 'General',
  PPBlock: 'PPBlock'
};

// Category aliases for convenience
const CATEGORY_ALIASES = {
  forms: 'Forms',
  form: 'Forms',
  cards: 'Cards',
  card: 'Cards',
  pp: 'PPBlock',
  productpage: 'PPBlock',
  general: 'General'
};

class Logger {
  constructor() {
    this.enabled = true;
    this.minLevel = this._getInitialLevel();
    this.allowedCategories = new Set(Object.values(CATEGORIES));
  }

  /**
   * Get initial log level from _ns.logLevel or localStorage
   */
  _getInitialLevel() {
    try {
      // First check _ns.logLevel
      if (typeof window !== 'undefined' && _ns && _ns.logLevel) {
        const level = _ns.logLevel.toLowerCase();
        if (LOG_LEVELS.hasOwnProperty(level)) {
          return LOG_LEVELS[level];
        }
      }

      // Then check localStorage
      if (typeof localStorage !== 'undefined') {
        const storedLevel = localStorage.getItem('wf_discount_log_level');
        if (storedLevel && LOG_LEVELS.hasOwnProperty(storedLevel.toLowerCase())) {
          return LOG_LEVELS[storedLevel.toLowerCase()];
        }
      }
    } catch (error) {
      // Silent fail if localStorage is not available
    }

    return LOG_LEVELS.info; // Default level
  }

  /**
   * Normalize category name using aliases
   */
  _normalizeCategory(category) {
    if (!category) return CATEGORIES.General;
    const lower = category.toLowerCase();
    return CATEGORY_ALIASES[lower] || CATEGORIES[category] || CATEGORIES.General;
  }

  /**
   * Check if logging should proceed for given level and category
   */
  _shouldLog(level, category) {
    if (!this.enabled) return false;
    if (LOG_LEVELS[level] < this.minLevel) return false;

    const normalizedCategory = this._normalizeCategory(category);
    return this.allowedCategories.has(normalizedCategory);
  }

  /**
   * Main logging method
   */
  log(message, data = null, type = 'info', category = 'General') {
    const normalizedCategory = this._normalizeCategory(category);

    if (!this._shouldLog(type, normalizedCategory)) return;

    try {
      const prefix = `[${normalizedCategory}][${type.toUpperCase()}]`;
      const consoleMethod = console[type] || console.log;

      if (data !== null && data !== undefined) {
        consoleMethod.call(console, prefix, message, data);
      } else {
        consoleMethod.call(console, prefix, message);
      }
    } catch (error) {
      // Silent fail - don't let logging break the app
    }
  }

  /**
   * Log an error with context
   */
  logError(error, context = '', category = 'General') {
    const normalizedCategory = this._normalizeCategory(category);

    if (!this._shouldLog('error', normalizedCategory)) return;

    try {
      const prefix = `[${normalizedCategory}][ERROR]`;

      if (context) {
        console.error(prefix, context, error);
      } else {
        console.error(prefix, error);
      }
    } catch (err) {
      // Silent fail
    }
  }

  /**
   * Log a warning with details
   */
  logWarning(message, details = null, category = 'General') {
    const normalizedCategory = this._normalizeCategory(category);

    if (!this._shouldLog('warn', normalizedCategory)) return;

    try {
      const prefix = `[${normalizedCategory}][WARN]`;

      if (details !== null && details !== undefined) {
        console.warn(prefix, message, details);
      } else {
        console.warn(prefix, message);
      }
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Convenience methods for specific log levels
   */
  debug(message, data = null, category = 'General') {
    this.log(message, data, 'debug', category);
  }

  info(message, data = null, category = 'General') {
    this.log(message, data, 'info', category);
  }

  warn(message, data = null, category = 'General') {
    this.log(message, data, 'warn', category);
  }

  error(message, data = null, category = 'General') {
    this.log(message, data, 'error', category);
  }

  /**
   * Set minimum log level
   */
  setMinLevel(level) {
    const levelLower = level.toLowerCase();
    if (LOG_LEVELS.hasOwnProperty(levelLower)) {
      this.minLevel = LOG_LEVELS[levelLower];

      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('wf_discount_log_level', levelLower);
        }
      } catch (error) {
        // Silent fail
      }
    }
  }

  /**
   * Set allowed categories
   */
  setAllowedCategories(categories) {
    if (Array.isArray(categories)) {
      this.allowedCategories = new Set(
        categories.map(cat => this._normalizeCategory(cat))
      );
    }
  }

  /**
   * Convenience toggles for specific categories
   */
  onlyForms() {
    this.setAllowedCategories(['Forms']);
    return this;
  }

  onlyCards() {
    this.setAllowedCategories(['Cards']);
    return this;
  }

  onlyPP() {
    this.setAllowedCategories(['PPBlock']);
    return this;
  }

  onlyGeneral() {
    this.setAllowedCategories(['General']);
    return this;
  }

  all() {
    this.setAllowedCategories(Object.values(CATEGORIES));
    return this;
  }
}

// Create and export singleton instance
export const logger = new Logger();

// Expose on window for global access
if (typeof window !== 'undefined') {
  _ns.logger = logger;
}
