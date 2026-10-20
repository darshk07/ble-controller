/// <reference types="vite/client" />

import type { LedApi } from '../../shared/ipc.ts';

declare global {
  interface Window {
    led: LedApi;
  }
}
