// App version, single-sourced from pyproject.toml via Vite `define`
// (vite.config.ts, #298).
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
