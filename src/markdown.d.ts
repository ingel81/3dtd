/** Markdown files are bundled as text: the ".md" loader in angular.json, a plugin in vitest.config.ts. */
declare module '*.md' {
  const text: string;
  export default text;
}
