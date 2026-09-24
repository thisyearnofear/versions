import { describe, expect, it, afterEach } from "vitest";
import { localUploadsAllowed } from "../../src/lib/upload-policy";

afterEach(() => {
  delete process.env.LOCAL_UPLOADS;
});

describe("localUploadsAllowed", () => {
  it("defaults to allowing local uploads", () => {
    expect(localUploadsAllowed()).toBe(true);
  });

  it("disables local uploads for 0/false/no/off", () => {
    for (const v of ["0", "false", "FALSE", "no", "off"]) {
      process.env.LOCAL_UPLOADS = v;
      expect(localUploadsAllowed()).toBe(false);
    }
  });

  it("allows local uploads for 1/true", () => {
    process.env.LOCAL_UPLOADS = "1";
    expect(localUploadsAllowed()).toBe(true);
    process.env.LOCAL_UPLOADS = "true";
    expect(localUploadsAllowed()).toBe(true);
  });
});
