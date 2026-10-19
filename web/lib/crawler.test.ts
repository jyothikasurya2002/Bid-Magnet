import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./crawler";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.8",
    "172.16.2.1",
    "192.168.1.1",
    "169.254.10.10",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("blocks private address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"])(
    "allows public address %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});
