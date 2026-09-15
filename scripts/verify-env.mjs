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
  "NEXT_PUBLIC_PROVIDER_TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_SECRET",
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
