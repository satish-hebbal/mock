/// <reference types="vite/client" />

/*
 * Rive files are not in Vite's default `assetsInclude` list, so they are opted
 * in there (see vite.config.ts) and given a type here. Same shape as Vite's
 * built-in image declarations: the import resolves to the emitted asset URL.
 */
declare module '*.riv' {
  const src: string
  export default src
}
