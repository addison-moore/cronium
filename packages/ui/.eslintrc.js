module.exports = {
  root: true,
  extends: ["@cronium/eslint-config"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
};
