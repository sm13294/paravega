// process for test files that were written for Node.js: env from the page's
// query string, exit() records the exit code for the driver.
export const process = {
  env: Object.fromEntries(new URLSearchParams(globalThis.location ? location.search : "")),
  exit: code => { globalThis.__pwExit = code ?? 0; },
  version: "browser",
  argv: [],
};
