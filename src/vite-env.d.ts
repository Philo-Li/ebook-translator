/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional CORS proxy for the "custom" and "OpenCode" providers. See worker/README.md. */
  readonly VITE_LLM_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
