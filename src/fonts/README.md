# Fonts

Oswald for titles, menu, buttons and HUD numbers (`--td-font-display`), the same
file as on the project page (`landing/media/fonts/`). SIL Open Font License 1.1,
2016 The Oswald Project Authors, licence in [OFL-Oswald.txt](OFL-Oswald.txt),
source https://github.com/googlefonts/OswaldFont. Variable, weights 400 to 700,
Latin subset.

`src/styles.scss` loads it by a relative URL, so the build bundles it into
`media/` and it works under any base href; CSP `font-src 'self'` allows it.
Inter Tight and JetBrains Mono come from `@fontsource`.
