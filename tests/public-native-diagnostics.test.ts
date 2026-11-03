import { describe, expect, it } from "vitest";
import { publicNativeCancellationKind } from "./helpers/public-native-diagnostics.mjs";

describe("public WebKit native diagnostics", () => {
  it("identifies only the fixed test origin's worker cancellation", () => {
    expect(publicNativeCancellationKind("/127.0.0.1:3198/sw.js?v=development due to access control checks.")).toBe("worker");
  });
  it("identifies the known navbar RSC cancellation for an explicit recovery check", () => {
    expect(publicNativeCancellationKind("/127.0.0.1:3198/settings?_rsc=hSpblVC7tpGZqHMV due to access control checks.")).toBe("prefetch");
  });
  it("keeps application exceptions, API failures and other origins fatal", () => {
    for (const message of ["TypeError: a cancelled request broke the app", "/127.0.0.1:3198/api/meals due to access control checks.", "/127.0.0.1:3198/settings?_rsc=abc&other=1 due to access control checks.", "/127.0.0.1:3198/account/delete?_rsc=abc due to access control checks.", "/evil.test/settings?_rsc=abc due to access control checks.", "/127.0.0.1:3001/settings?_rsc=abc due to access control checks."]) {
      expect(publicNativeCancellationKind(message)).toBeNull();
    }
  });
});
