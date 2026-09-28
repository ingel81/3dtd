// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

const SEEDED_RANDOM = {
  object: "Math",
  property: "random",
  message: "Simulation code draws from the seeded GameRng (gsm.rng.stream), or coop runs apart. Sound and pictures only: disable with a reason.",
};
/** Transcendentals whose last bit differs between engines (TODO E28) */
const DET_MATH = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "expm1", "log", "log1p", "log2", "log10",
  "pow", "hypot", "cbrt", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh"].map((property) => ({
  object: "Math",
  property,
  message: "Simulation code uses DetMath (utils/det-math.ts): native transcendentals differ in the last bit between engines, and coop runs apart. Sound and pictures only: disable with a reason.",
}));
/**
 * three.js methods that call native transcendentals or Math.random inside
 * (Quaternion slerp: Math.acos and Math.sin; angleTo: Math.acos; axis
 * angles, Euler angles, spherical coordinates and rotations: Math.sin,
 * Math.cos, Math.asin, Math.atan2; MathUtils.rand*: Math.random). The names
 * are matched on any object: Quaternion.setFromRotationMatrix shares its
 * name with Euler's and is caught as well.
 */
const DET_THREE_METHODS = {
  selector: "CallExpression[callee.property.name=/^(angleTo|slerp|slerpQuaternions|slerpFlat|setFromAxisAngle|applyAxisAngle|applyEuler|rotateOnAxis|rotateOnWorldAxis|setFromEuler|setFromQuaternion|setFromRotationMatrix|setFromSpherical|setFromSphericalCoords|setFromCylindrical|setFromCartesianCoords|setFromVector3|makeRotationX|makeRotationY|makeRotationZ|makeRotationAxis|makeRotationFromEuler|rotateX|rotateY|rotateZ|rotateAround|angle|randFloat|randFloatSpread|randInt|seededRandom)$/]",
  message: "Simulation code: this three.js method computes with native sin, cos, acos or Math.random, which differ between engines or clients (TODO E28). Use DetMath or the run's GameRng, or disable with a reason where only pictures read the result.",
};
/** `x ** y` is Math.pow; only squaring by a literal 2 is exact everywhere */
const DET_POW_OPERATOR = {
  selector: "BinaryExpression[operator='**']:not([right.value=2])",
  message: "Simulation code uses DetMath.pow: `**` is Math.pow, whose last bit differs between engines. `x ** 2` is fine.",
};

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
    // Coop lockstep (TODO E63 c, E28): the simulation draws only from the run's seeded GameRng
    // (gsm.rng.stream) and computes transcendentals with DetMath (utils/det-math.ts), the same
    // bits in every engine. Sound and pictures may use both: the ignored files, the block below.
    files: [
      "src/app/managers/**/*.ts",
      "src/app/entities/**/*.ts",
      "src/app/game-components/**/*.ts",
      "src/app/utils/**/*.ts",
      "src/app/services/combat/**/*.ts",
      "src/app/director/**/*.ts",
      "src/app/simulator/**/*.ts",
      "src/app/coop/**/*.ts",
      "src/app/configs/**/*.ts",
      "src/app/three-engine/ellipsoid-sync.ts",
    ],
    ignores: [
      "**/*.spec.ts",
      "src/app/managers/audio/**",
      "src/app/services/combat/combat-vfx.service.ts",
      "src/app/utils/game-rng.ts",
    ],
    rules: {
      "no-restricted-properties": ["error", SEEDED_RANDOM, ...DET_MATH],
      "no-restricted-syntax": ["error", DET_POW_OPERATOR, DET_THREE_METHODS],
    },
  },
  {
    // Sound, pictures and the camera among the sim files: native transcendentals, never in the state
    files: [
      "src/app/managers/worm/worm-sounds.ts",
      "src/app/managers/ooze-sounds.ts",
      "src/app/utils/*-sound.ts",
      "src/app/utils/alert-tone.ts",
      "src/app/utils/synth.ts",
      "src/app/utils/boss-intro.ts",
      "src/app/utils/camera-*.ts",
      "src/app/utils/offscreen-indicators.ts",
      "src/app/utils/missile-flight.ts",
      "src/app/configs/visual-effects.config.ts",
      "src/app/configs/audio.config.ts",
      "src/app/configs/game-sounds.config.ts",
    ],
    ignores: ["**/*.spec.ts"],
    rules: {
      "no-restricted-properties": ["error", SEEDED_RANDOM],
      "no-restricted-syntax": "off",
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
