import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  }
);
