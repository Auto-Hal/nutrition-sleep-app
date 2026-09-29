const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL", "APP_SESSION_ENCRYPTION_KEY", "APP_ALLOWED_USER_ID", "APP_LOGIN_RATE_LIMIT_KEY", "APP_ORIGIN"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing server environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.SUPABASE_URL.includes("study-graph") || process.env.SUPABASE_URL.includes("money-canvas")) {
  console.error("Study Graph and money-canvas Supabase projects are out of scope.");
  process.exit(1);
}
const publicKeyNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_GOOGLE_CLOUD_VISION_API_KEY",
  "NEXT_PUBLIC_YAHOO_SHOPPING_CLIENT_ID",
  "NEXT_PUBLIC_PROVIDER_TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_SECRET",
  "NEXT_PUBLIC_CRON_SECRET",
  "NEXT_PUBLIC_SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_ACCOUNT_DELETION_STATUS_HMAC_KEY",
];
if (publicKeyNames.some((key) => process.env[key])) {
  console.error("Server credentials must not be exposed as public environment variables.");
  process.exit(1);
}
const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
if (expectedRef && expectedRef !== "replace_me") {
  const match = process.env.SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (match && match[1] !== expectedRef) {
    console.error(`SUPABASE_URL does not match EXPECTED_SUPABASE_PROJECT_REF (${expectedRef}).`);
    process.exit(1);
  }
}
if (Buffer.byteLength(process.env.APP_SESSION_ENCRYPTION_KEY) < 32) {
  console.error("APP_SESSION_ENCRYPTION_KEY must contain at least 32 bytes.");
  process.exit(1);
}
if (process.env.PROVIDER_TOKEN_ENCRYPTION_KEY && Buffer.byteLength(process.env.PROVIDER_TOKEN_ENCRYPTION_KEY) < 32) {
  console.error("PROVIDER_TOKEN_ENCRYPTION_KEY must contain at least 32 bytes when configured.");
  process.exit(1);
}
const googleHealthKeys = [
  "GOOGLE_HEALTH_CLIENT_ID",
  "GOOGLE_HEALTH_CLIENT_SECRET",
  "GOOGLE_HEALTH_REDIRECT_URI",
  "PROVIDER_TOKEN_ENCRYPTION_KEY",
];
const googleHealthConfiguredCount = googleHealthKeys.filter((key) => process.env[key]).length;
if (googleHealthConfiguredCount > 0 && googleHealthConfiguredCount !== googleHealthKeys.length) {
  console.error("Google Health OAuth environment must be configured as a complete set.");
  process.exit(1);
}
if (process.env.GOOGLE_HEALTH_REDIRECT_URI) {
  try {
    const redirect = new URL(process.env.GOOGLE_HEALTH_REDIRECT_URI);
    const localHttp = redirect.protocol === "http:" && (redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1");
    if (redirect.protocol !== "https:" && !localHttp) throw new Error();
    if (redirect.pathname !== "/api/health/google/callback" || redirect.search || redirect.hash) throw new Error();
  } catch {
    console.error("GOOGLE_HEALTH_REDIRECT_URI must be an exact OAuth callback URL.");
    process.exit(1);
  }
}
if (process.env.CRON_SECRET && Buffer.byteLength(process.env.CRON_SECRET) < 32) {
  console.error("CRON_SECRET must contain at least 32 bytes when configured.");
  process.exit(1);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.env.APP_ALLOWED_USER_ID)) {
  console.error("APP_ALLOWED_USER_ID must be a valid UUID.");
  process.exit(1);
}
if (Buffer.byteLength(process.env.APP_LOGIN_RATE_LIMIT_KEY) < 32) {
  console.error("APP_LOGIN_RATE_LIMIT_KEY must contain at least 32 bytes.");
  process.exit(1);
}
try {
  const origin = new URL(process.env.APP_ORIGIN);
  if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new Error();
} catch {
  console.error("APP_ORIGIN must be an absolute http(s) URL.");
  process.exit(1);
}
console.log("Environment contract passed.");


const accountDeletionKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ACCOUNT_DELETION_STATUS_HMAC_KEY",
  "ACCOUNT_DELETION_ADMIN_ENVIRONMENT",
];
const accountDeletionConfiguredCount = accountDeletionKeys.filter((key) => process.env[key]).length;
if (accountDeletionConfiguredCount > 0 && accountDeletionConfiguredCount !== accountDeletionKeys.length) {
  console.error("Account deletion admin environment must be configured as a complete set.");
  process.exit(1);
}
if (accountDeletionConfiguredCount === accountDeletionKeys.length) {
  if (!expectedRef || expectedRef === "replace_me") {
    console.error("Account deletion requires EXPECTED_SUPABASE_PROJECT_REF.");
    process.exit(1);
  }
  if (Buffer.byteLength(process.env.SUPABASE_SERVICE_ROLE_KEY) < 32) {
    console.error("SUPABASE_SERVICE_ROLE_KEY must contain at least 32 bytes.");
    process.exit(1);
  }
  if (Buffer.byteLength(process.env.ACCOUNT_DELETION_STATUS_HMAC_KEY) < 32) {
    console.error("ACCOUNT_DELETION_STATUS_HMAC_KEY must contain at least 32 bytes.");
    process.exit(1);
  }
  if (!["development", "preview", "production"].includes(process.env.ACCOUNT_DELETION_ADMIN_ENVIRONMENT)) {
    console.error("ACCOUNT_DELETION_ADMIN_ENVIRONMENT must be development, preview, or production.");
    process.exit(1);
  }
  const runtimeEnvironment =
    process.env.VERCEL_ENV
    ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  if (runtimeEnvironment !== process.env.ACCOUNT_DELETION_ADMIN_ENVIRONMENT) {
    console.error("Account deletion admin environment does not match the current deployment environment.");
    process.exit(1);
  }
}
