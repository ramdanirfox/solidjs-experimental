interface ImportMetaEnv {
  readonly VITE_PUBLIC_MAP_KEY: string;
  readonly VITE_PUBLIC_MAP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}