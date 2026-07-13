// @types/prismjs declares the main `prismjs` module but not its plugin
// submodules, which are plain untyped JS files. Without these, a static
// `import("prismjs/plugins/...")` fails with TS7016.
//
// A static import (rather than an `import(variable)`) also lets webpack resolve
// the path at build time, which avoids a "Critical dependency: the request of a
// dependency is an expression" warning in every app that bundles this package.
declare module "prismjs/plugins/line-numbers/prism-line-numbers";
