import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reference apps that deploy ships as they are, and the Google Cloud CLI when it is unpacked here.
    "deploy-templates/**",
    "google-cloud-sdk/**",
    // Generated project repos and the database. Deploy copies the reference apps into data/deploy.
    "data/**",
  ]),
]);

export default eslintConfig;
