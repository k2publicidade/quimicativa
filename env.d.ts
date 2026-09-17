import type { R2Bucket } from "@cloudflare/workers-types";

declare global {
  namespace Cloudflare {
    interface Env {
      FILES: R2Bucket;
    }
  }
}

export {};
