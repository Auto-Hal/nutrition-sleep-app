import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashSessionId } from "@/lib/security/crypto";

describe("server session crypto", () => {
  it("round trips encrypted token material without exposing plaintext", () => {
    const encrypted = encryptSecret("token-value", "test-key");
    expect(encrypted).not.toContain("token-value");
    expect(decryptSecret(encrypted, "test-key")).toBe("token-value");
  });

  it("hashes the application cookie identifier", () => {
    expect(hashSessionId("session-id")).toHaveLength(64);
    expect(hashSessionId("session-id")).not.toBe("session-id");
  });
});
