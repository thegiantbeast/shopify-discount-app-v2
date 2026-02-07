import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/logger.server.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("cors.server.js", () => {
  let isOriginAllowed, getCorsHeaders, createCorsPreflightResponse;
  let originalNodeEnv;

  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    vi.resetModules();
    const corsModule = await import("../../utils/cors.server.js");
    isOriginAllowed = corsModule.isOriginAllowed;
    getCorsHeaders = corsModule.getCorsHeaders;
    createCorsPreflightResponse = corsModule.createCorsPreflightResponse;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("isOriginAllowed", () => {
    it("should allow null origin (same-origin)", () => {
      expect(isOriginAllowed(null)).toBe(true);
    });

    it("should allow Shopify myshopify.com domains", () => {
      expect(isOriginAllowed("https://test-store.myshopify.com")).toBe(true);
    });

    it("should allow Shopify admin domain", () => {
      expect(isOriginAllowed("https://admin.shopify.com")).toBe(true);
    });

    it("should allow custom HTTPS domains", () => {
      expect(isOriginAllowed("https://custom-store.com")).toBe(true);
    });

    it("should block HTTP localhost in production", async () => {
      process.env.NODE_ENV = "production";
      vi.resetModules();
      const corsModule = await import("../../utils/cors.server.js");
      expect(corsModule.isOriginAllowed("http://localhost")).toBe(false);
    });

    it("should allow HTTP localhost in development", async () => {
      process.env.NODE_ENV = "development";
      vi.resetModules();
      const corsModule = await import("../../utils/cors.server.js");
      expect(corsModule.isOriginAllowed("http://localhost")).toBe(true);
      expect(corsModule.isOriginAllowed("http://localhost:3000")).toBe(true);
    });

    it("should allow app domain", () => {
      expect(isOriginAllowed("https://test.wizardformula.pt")).toBe(true);
    });

    it("should block non-HTTPS custom domain in production", async () => {
      process.env.NODE_ENV = "production";
      vi.resetModules();
      const corsModule = await import("../../utils/cors.server.js");
      expect(corsModule.isOriginAllowed("http://evil.com")).toBe(false);
    });

    it("should allow random HTTPS domains", () => {
      expect(isOriginAllowed("https://anything.valid.com")).toBe(true);
    });
  });

  describe("getCorsHeaders", () => {
    it("should return wildcard for no origin", () => {
      const request = new Request("https://example.com/api");
      const headers = getCorsHeaders(request, ["GET", "POST"]);

      expect(headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST");
      expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Authorization");
      expect(headers["Vary"]).toBe("Origin");
    });

    it("should reflect allowed origin back", () => {
      const request = new Request("https://example.com/api", {
        headers: { Origin: "https://test-store.myshopify.com" },
      });
      const headers = getCorsHeaders(request, ["GET"]);

      expect(headers["Access-Control-Allow-Origin"]).toBe("https://test-store.myshopify.com");
      expect(headers["Vary"]).toBe("Origin");
    });

    it("should return null for blocked origin", async () => {
      process.env.NODE_ENV = "production";
      vi.resetModules();
      const corsModule = await import("../../utils/cors.server.js");

      const request = new Request("https://example.com/api", {
        headers: { Origin: "http://evil.com" },
      });
      const headers = corsModule.getCorsHeaders(request, ["GET"]);

      expect(headers["Access-Control-Allow-Origin"]).toBe("null");
    });

    it("should always include Vary: Origin", () => {
      const request1 = new Request("https://example.com/api");
      const headers1 = getCorsHeaders(request1, ["GET"]);
      expect(headers1["Vary"]).toBe("Origin");

      const request2 = new Request("https://example.com/api", {
        headers: { Origin: "https://test.com" },
      });
      const headers2 = getCorsHeaders(request2, ["GET"]);
      expect(headers2["Vary"]).toBe("Origin");
    });
  });

  describe("createCorsPreflightResponse", () => {
    it("should return 200 with CORS headers", () => {
      const request = new Request("https://example.com/api", {
        method: "OPTIONS",
        headers: { Origin: "https://test-store.myshopify.com" },
      });
      const response = createCorsPreflightResponse(request, ["GET", "POST"]);

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://test-store.myshopify.com");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST");
    });

    it("should return response with null body", async () => {
      const request = new Request("https://example.com/api", {
        method: "OPTIONS",
      });
      const response = createCorsPreflightResponse(request, ["GET"]);

      const body = await response.text();
      expect(body).toBe("");
    });
  });
});
