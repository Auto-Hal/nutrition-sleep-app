import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertHostedTarget } from "../scripts/verify-hosted-target.mjs";

const preview = "pprsfxpfljdjlwdfbtqo";
const production = "vyvnicyupcrsmtgdyypv";
const api = (ref: string) => `https://${ref}.supabase.co`;
const direct = (ref: string) =>
  `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres`;
const pooled = (ref: string, port = 6543) =>
  `postgresql://postgres.${ref}:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:${port}/postgres?sslmode=require`;

describe("hosted environment separation", () => {
  it.each([
    ["preview", api(preview), direct(preview)],
    ["preview", api(preview), pooled(preview, 5432)],
    ["preview", api(preview), pooled(preview)],
    ["preview", api(preview), direct(preview).replace(":5432", ":6543")],
    ["production", api(production), direct(production)],
  ] as const)(
    "accepts the matching %s project using documented endpoints",
    (target, url, database) => {
      expect(() =>
        assertHostedTarget(
          { SUPABASE_URL: url, DATABASE_URL: database },
          target,
        ),
      ).not.toThrow();
    },
  );

  it.each([
    [api(production), direct(preview)],
    [api(preview), direct(production)],
    [api(preview), pooled(production)],
    [
      api(preview),
      `postgresql://postgres.${preview}:synthetic@unverified.invalid:5432/postgres`,
    ],
    [api(preview), `${direct(preview)}?host=db.${production}.supabase.co`],
    [api(preview), direct(preview).replace(/\/postgres$/, "/another_database")],
    [api(preview), `${direct(preview)}#ignored-fragment`],
    [`https://user:synthetic@${preview}.supabase.co`, direct(preview)],
    [`${api(preview)}/other-path`, direct(preview)],
    ["invalid", "invalid"],
    ["", ""],
  ])(
    "rejects mismatched or unverifiable targets without connecting",
    (url, database) => {
      expect(() =>
        assertHostedTarget(
          { SUPABASE_URL: url, DATABASE_URL: database },
          "preview",
        ),
      ).toThrow();
    },
  );

  it("does not leak rejected connection strings or passwords in CLI output", () => {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/verify-hosted-target.mjs"), "preview"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_URL: api(preview),
          DATABASE_URL:
            "postgresql://postgres:DO_NOT_PRINT_CREDENTIAL@invalid.invalid/postgres",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      "Hosted target verification failed",
    );
    expect(result.stdout + result.stderr).not.toMatch(
      /DO_NOT_PRINT_CREDENTIAL|invalid\.invalid|postgresql:/,
    );
  });
});
