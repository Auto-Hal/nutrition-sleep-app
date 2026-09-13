import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });
const config = [...compat.extends("next/core-web-vitals")];

const eslintConfig = [{ ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**"] }, ...config];

export default eslintConfig;
