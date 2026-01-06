// Local ESLint flat config for Cloud Functions.
// This prevents the repo-root `eslint.config.js` (frontend) from breaking Functions lint.

module.exports = [
  {
    ignores: [".eslintrc.js"],
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        exports: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
