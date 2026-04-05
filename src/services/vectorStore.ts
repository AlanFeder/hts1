import { ChromaClient, IncludeEnum, type Collection, type IEmbeddingFunction } from "chromadb";
import { config } from "../config.js";

// Dummy embedding function — we always supply our own embeddings.
// ChromaDB v1 requires one to be set even when using precomputed embeddings.
const noopEmbedding: IEmbeddingFunction = {
  generate: async (texts: string[]) => texts.map(() => []),
};

export const COLLECTION_AVG = "hts_entries";
export const COLLECTION_LEAF = "hts_entries_leaf";
export const COLLECTION_PATH = "hts_entries_path";

export interface VectorResult {
  hts_code: string;
  description: string;
  path: string[];
  indent: number;
  general_rate: string;
  score: number;
}

export class VectorStore {
  private collection: Collection | null = null;
  private readonly name: string;
  private client: ChromaClient;

  constructor(collectionName: string = COLLECTION_AVG) {
    this.name = collectionName;
    this.client = new ChromaClient({ path: config.chromaUrl });
  }

  async init(): Promise<void> {
    this.collection = await this.client.getCollection({ name: this.name, embeddingFunction: noopEmbedding });
  }

  get count(): Promise<number> {
    return this.getCollection().count();
  }

  private getCollection(): Collection {
    if (!this.collection) throw new Error(`VectorStore '${this.name}' not initialized`);
    return this.collection;
  }

  async query(embedding: number[], topK: number = 5): Promise<VectorResult[]> {
    const col = this.getCollection();
    const results = await col.query({
      queryEmbeddings: [embedding],
      nResults: topK,
      include: [IncludeEnum.Metadatas, IncludeEnum.Distances],
    });

    const metadatas = results.metadatas?.[0] ?? [];
    const distances = results.distances?.[0] ?? [];

    return metadatas.map((meta, i) => ({
      hts_code: String(meta?.hts_code ?? ""),
      description: String(meta?.description ?? ""),
      path: String(meta?.path ?? "").split(" | "),
      indent: Number(meta?.indent ?? 0),
      general_rate: String(meta?.general_rate ?? ""),
      score: 1.0 - (distances[i] ?? 0), // cosine distance → similarity
    }));
  }
}
