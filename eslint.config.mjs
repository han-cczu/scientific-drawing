import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "dist/**", "data/**", "playwright-report/**", "test-results/**"] },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } }
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-unreachable": js.configs.recommended.rules["no-unreachable"],
      "valid-typeof": js.configs.recommended.rules["valid-typeof"],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  }
];
