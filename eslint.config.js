// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Allow unused vars/args with _ prefix (common convention)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: ["app", "td"],
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: ["app", "td"],
          style: "kebab-case",
        },
      ],
    },
  },
  {
    // Coop lockstep (TODO E63 c): the simulation draws only from the run's seeded GameRng
    // (gsm.rng.stream). Sound and pictures may use Math.random; they live in the ignored files.
    files: [
      "src/app/managers/**/*.ts",
      "src/app/entities/**/*.ts",
      "src/app/game-components/**/*.ts",
      "src/app/utils/**/*.ts",
      "src/app/services/combat/**/*.ts",
      "src/app/director/**/*.ts",
      "src/app/simulator/**/*.ts",
      "src/app/coop/**/*.ts",
    ],
    ignores: [
      "**/*.spec.ts",
      "src/app/managers/audio/**",
      "src/app/services/combat/combat-vfx.service.ts",
      "src/app/utils/game-rng.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Simulation code draws from the seeded GameRng (gsm.rng.stream), or coop runs apart. Sound and pictures only: disable with a reason.",
        },
      ],
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {},
  }
]);
