import { afterEach, describe, expect, it } from "vitest";
import { apiCredentials, apiUrl, getApiBase } from "../../src/lib/api-base";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_API_URL;
});

describe("api-base", () => {
  it("keeps relative paths when NEXT_PUBLIC_API_URL is unset", () => {
    expect(getApiBase()).toBe("");
    expect(apiUrl("/api/v1/listings")).toBe("/api/v1/listings");
    expect(apiCredentials()).toBe("same-origin");
  });

  it("prefixes paths and switches credentials when base is set", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";
    expect(getApiBase()).toBe("https://api.example.com");
    expect(apiUrl("/api/v1/channels")).toBe("https://api.example.com/api/v1/channels");
    expect(apiCredentials()).toBe("include");
  });
});
