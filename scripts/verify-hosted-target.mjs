import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PROJECTS = {
  preview: "pprsfxpfljdjlwdfbtqo",
  production: "vyvnicyupcrsmtgdyypv",
};
const CONNECTION_OPTIONS = new Set([
  "sslmode",
  "pgbouncer",
  "connect_timeout",
  "connection_limit",
  "application_name",
]);
function parsedUrl(value) {
  try {
    return typeof value === "string" ? new URL(value) : null;
  } catch {
    // URL errors can contain the connection string. Never propagate them.
    return null;
  }
}

/** Checks configuration only: no network, authentication or database writes.
 * @param {{ SUPABASE_URL?: string, DATABASE_URL?: string }} env
 * @param {"preview" | "production"} environment
 */
export function assertHostedTarget(env, environment) {
  const project = PROJECTS[environment];
  if (!project) throw new Error("Unsupported hosted environment");
  const api = parsedUrl(env.SUPABASE_URL);
  if (
    !api ||
    api.protocol !== "https:" ||
    api.hostname !== `${project}.supabase.co` ||
    api.port ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    api.pathname !== "/"
  )
    throw new Error("SUPABASE_URL does not match the dedicated environment");

  const db = parsedUrl(env.DATABASE_URL);
  if (
    !db ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    !db.username ||
    !db.password ||
    db.hash ||
    db.pathname !== "/postgres" ||
    !["", "5432", "6543"].includes(db.port) ||
    [...db.searchParams.keys()].some((key) => !CONNECTION_OPTIONS.has(key))
  )
    throw new Error("DATABASE_URL cannot be verified for this environment");
  let user;
  try {
    user = decodeURIComponent(db.username);
  } catch {
    throw new Error("DATABASE_URL username cannot be verified");
  }
  const direct = db.hostname === `db.${project}.supabase.co`;
  const sharedPooler =
    db.hostname.endsWith(".pooler.supabase.com") &&
    user.endsWith(`.${project}`);
  if (!direct && !sharedPooler)
    throw new Error(
      "DATABASE_URL project does not match the dedicated environment",
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const environment = process.argv[2] ?? process.env.VERCEL_ENV;
  if (!environment || environment === "development") {
    console.log(
      "Hosted target verification is not required in local development.",
    );
  } else {
    try {
      if (environment !== "preview" && environment !== "production")
        throw new Error("Unsupported environment");
      assertHostedTarget(process.env, environment);
      console.log(
        `Dedicated Supabase URL and database project verified for ${environment}.`,
      );
    } catch {
      console.error(
        "Hosted target verification failed. Check the dedicated SUPABASE_URL and DATABASE_URL settings.",
      );
      process.exitCode = 1;
    }
  }
}
