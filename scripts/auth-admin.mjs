import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const action = process.argv[2];
if (action !== "set-password" && action !== "recover-password") {
  console.error("Usage: pnpm auth:admin -- set-password|recover-password");
  process.exit(1);
}
if (process.env.VERCEL || process.env.CI) {
  console.error("The password utility is local-only.");
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, APP_ALLOWED_USER_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL || !APP_ALLOWED_USER_ID) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, and APP_ALLOWED_USER_ID are required.");
  process.exit(1);
}
if (!SUPABASE_URL.includes("pprsfxpfljdjlwdfbtqo")) {
  console.error("This utility is restricted to the dedicated Preview Supabase project.");
  process.exit(1);
}
if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_") || SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_anon_")) {
  console.error("A server admin key is required; publishable keys are not accepted.");
  process.exit(1);
}

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Run this utility from a local interactive terminal."));
      return;
    }
    let value = "";
    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

let password = "";
let confirmation = "";
try {
  password = await readSecret("New password (input is hidden): ");
  confirmation = await readSecret("Repeat password (input is hidden): ");
  if (password.length < 12 || password.length > 1024) throw new Error("Password must be between 12 and 1024 characters.");
  if (password !== confirmation) throw new Error("Passwords do not match.");

  const db = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    // Recovery and initial setup both revoke every app session before the new
    // credential becomes usable. No token or password is written to the DB.
    await db.query("update private.app_sessions set revoked_at = now(), revision = revision + 1 where user_id = $1 and revoked_at is null", [APP_ALLOWED_USER_ID]);
  } finally {
    await db.end();
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.auth.admin.updateUserById(APP_ALLOWED_USER_ID, { password });
  if (error) throw new Error("Supabase rejected the password update.");
  console.log("Password updated and existing app sessions revoked.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Password update failed.");
  process.exitCode = 1;
} finally {
  password = "";
  confirmation = "";
}
