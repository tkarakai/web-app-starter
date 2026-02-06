import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".auto-claude/**",
      "convex/_generated/**",
      "qa/coverage/**",
      "qa/playwright-report/**",
      "qa/test-results/**",
      "qa/e2e/__screenshots__/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        React: "readonly",
        JSX: "readonly",
        console: "readonly",
        process: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        HTMLElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLFormElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLHeadingElement: "readonly",
        HTMLParagraphElement: "readonly",
        HTMLSpanElement: "readonly",
        HTMLTextAreaElement: "readonly",
        document: "readonly",
        window: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-unused-vars": "off",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
];
