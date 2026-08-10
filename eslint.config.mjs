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
  ]),
  // Prevent dynamic imports of Node built-ins in API routes (causes NFT trace bloat / secret leaks)
  {
    files: ["src/app/api/**/*.ts", "src/app/api/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression[source.value=/^(crypto|fs|path|os|child_process|net|tls|dns|cluster)$/]",
          message:
            "Use a static top-level import for Node built-ins in API routes. Dynamic import() causes @vercel/nft to trace the entire project root, leaking .git and .env into the bundle.",
        },
      ],
    },
  },
]);

export default eslintConfig;
