import "server-only";

import { OUTBOX_CONTRACT_VERSION } from "@/lib/offline/outbox-contract";

export function appBuildVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.VERCEL_DEPLOYMENT_ID
    ?? process.env.npm_package_version
    ?? "development"
  );
}

export function appRuntimeContract() {
  return {
    buildVersion: appBuildVersion(),
    outboxContractVersion: OUTBOX_CONTRACT_VERSION,
  };
}
