const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL", "APP_SESSION_ENCRYPTION_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing server environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.SUPABASE_URL.includes("study-graph") || process.env.SUPABASE_URL.includes("money-canvas")) {
  console.error("Study Graph and money-canvas Supabase projects are out of scope.");
  process.exit(1);
}
if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error("Supabase privileged or legacy keys must not be public environment variables.");
  process.exit(1);
}
if (Buffer.byteLength(process.env.APP_SESSION_ENCRYPTION_KEY) < 32) {
  console.error("APP_SESSION_ENCRYPTION_KEY must contain at least 32 bytes.");
  process.exit(1);
}
console.log("Environment contract passed.");
