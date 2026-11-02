export function assertHostedTarget(
  env: { SUPABASE_URL?: string; DATABASE_URL?: string },
  environment: "preview" | "production",
): void;
