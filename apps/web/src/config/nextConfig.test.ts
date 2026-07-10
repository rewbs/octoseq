import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("security headers", () => {
  it("allows WaveSurfer to fetch local blob URLs", async () => {
    const routes = await nextConfig.headers?.();
    const contentSecurityPolicy = routes
      ?.flatMap((route) => route.headers)
      .find((header) => header.key === "Content-Security-Policy");

    const connectSource = contentSecurityPolicy?.value
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src "));

    expect(connectSource?.split(/\s+/)).toContain("blob:");
  });
});
