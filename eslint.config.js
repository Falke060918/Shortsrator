import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "mockup/**",
      "scripts/**",
      "workspace/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
