import { supabaseAdmin } from "./admin";

/**
 * Storage de arquivos sobre o Supabase Storage, com a MESMA interface do
 * binding R2 usado pelo app (get / put / delete), para as rotas de documentos,
 * FISPQ, laudos de pedido e documentos de veiculo nao precisarem mudar.
 */
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "arquivos";

export type StoredObject = {
  body: ArrayBuffer;
  httpMetadata: { contentType: string };
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function getFiles() {
  const storage = supabaseAdmin().storage.from(BUCKET);
  return {
    async get(key: string): Promise<StoredObject | null> {
      const { data, error } = await storage.download(key);
      if (error || !data) return null;
      const body = await data.arrayBuffer();
      return {
        body,
        httpMetadata: { contentType: data.type || "application/octet-stream" },
        size: body.byteLength,
        arrayBuffer: async () => body,
      };
    },
    async put(
      key: string,
      bytes: ArrayBuffer | Uint8Array,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ): Promise<void> {
      const { error } = await storage.upload(key, bytes as ArrayBuffer, {
        contentType:
          options?.httpMetadata?.contentType || "application/octet-stream",
        upsert: true,
      });
      if (error) throw new Error(`Falha ao gravar arquivo: ${error.message}`);
    },
    async delete(key: string): Promise<void> {
      const { error } = await storage.remove([key]);
      if (error) throw new Error(`Falha ao remover arquivo: ${error.message}`);
    },
  };
}
