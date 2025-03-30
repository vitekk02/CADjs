import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default [
  eslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "react/display-name": "off",
      "react/self-closing-comp": [
        "error",
        {
          component: true,
          html: true,
        },
      ],
      "no-undef": "off",
      "no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "warn",
      "spaced-comment": "error",
      quotes: ["error", "double"],
      "no-duplicate-imports": "error",
      "no-fallthrough": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "no-constant-condition": [
        "error",
        {
          checkLoops: false,
        },
      ],
    },
  },
  prettierConfig,
];
