import { readFileSync } from "fs";

export const COLLECTION_AVG = "avg";
export const COLLECTION_LEAF = "leaf";
export const COLLECTION_PATH = "path";

export interface VectorResult {
	hts_code: string;
	description: string;
	path: string[];
	indent: number;
	general_rate: string;
	score: number;
}

interface StoredMeta {
	hts_code: string;
	description: string;
	path: string[];
	indent: number;
	general_rate: string;
}

export class VectorStore {
	private embeddings!: Float32Array; // flat (N * dim), pre-normalized
	private metadata!: StoredMeta[];
	private N!: number;
	private dim!: number;

	constructor(private readonly name: string) {}

	/**
	 * Load from the binary + JSON files produced by scripts/export_embeddings.py.
	 * Binary format: [N: uint32][dim: uint32][N*dim float32, little-endian]
	 */
	load(binPath: string, metaPath: string): void {
		// ── Read binary embeddings ──────────────────────────────────────────────
		const buf = readFileSync(binPath);
		this.N = buf.readUInt32LE(0);
		this.dim = buf.readUInt32LE(4);

		// Copy float bytes into a fresh aligned buffer to avoid alignment issues
		this.embeddings = new Float32Array(this.N * this.dim);
		const src = buf.subarray(8);
		new Uint8Array(this.embeddings.buffer).set(src);

		// ── Pre-normalise all stored vectors ───────────────────────────────────
		// Cosine similarity = dot product when both sides are unit vectors.
		// Normalising once at load time lets query() skip per-vector norms.
		for (let i = 0; i < this.N; i++) {
			const off = i * this.dim;
			let norm = 0;
			for (let j = 0; j < this.dim; j++) norm += this.embeddings[off + j]! ** 2;
			norm = Math.sqrt(norm);
			if (norm > 0) {
				const inv = 1 / norm;
				for (let j = 0; j < this.dim; j++) this.embeddings[off + j]! *= inv;
			}
		}

		// ── Read metadata ──────────────────────────────────────────────────────
		this.metadata = JSON.parse(readFileSync(metaPath, "utf8")) as StoredMeta[];
		console.info(
			`vectorStore(${this.name}) | loaded ${this.N.toLocaleString()} vectors (dim=${this.dim})`,
		);
	}

	get count(): number {
		return this.N;
	}

	query(embedding: number[], topK: number = 5): VectorResult[] {
		// Normalise query vector
		let qNorm = 0;
		for (const v of embedding) qNorm += v * v;
		qNorm = Math.sqrt(qNorm);
		const inv = qNorm > 0 ? 1 / qNorm : 0;
		const q = new Float32Array(this.dim);
		for (let j = 0; j < this.dim; j++) q[j] = embedding[j]! * inv;

		// Dot products against all pre-normalised stored vectors (= cosine similarity)
		const scores = new Float32Array(this.N);
		const emb = this.embeddings;
		const dim = this.dim;
		for (let i = 0; i < this.N; i++) {
			const off = i * dim;
			let dot = 0;
			for (let j = 0; j < dim; j++) dot += emb[off + j]! * q[j]!;
			scores[i] = dot;
		}

		// Partial selection: find top-k indices without sorting all N
		const topIndices = topKIndices(scores, topK);

		return topIndices.map((i) => ({
			...this.metadata[i]!,
			score: scores[i]!,
		}));
	}
}

/**
 * Returns the indices of the k largest values in `scores`, sorted descending.
 * O(N·k) — much faster than full O(N log N) sort for small k.
 */
function topKIndices(scores: Float32Array, k: number): number[] {
	const n = scores.length;
	k = Math.min(k, n);

	// Min-heap of size k: each entry is [score, index]
	const heap: [number, number][] = [];

	for (let i = 0; i < n; i++) {
		const s = scores[i]!;
		if (heap.length < k) {
			heap.push([s, i]);
			if (heap.length === k) buildMinHeap(heap);
		} else if (s > heap[0]![0]) {
			heap[0] = [s, i];
			siftDown(heap, 0);
		}
	}

	// Sort heap descending by score
	heap.sort((a, b) => b[0] - a[0]);
	return heap.map(([, idx]) => idx);
}

function buildMinHeap(h: [number, number][]): void {
	for (let i = Math.floor(h.length / 2) - 1; i >= 0; i--) siftDown(h, i);
}

function siftDown(h: [number, number][], i: number): void {
	const n = h.length;
	while (true) {
		let smallest = i;
		const l = 2 * i + 1;
		const r = 2 * i + 2;
		if (l < n && h[l]![0] < h[smallest]![0]) smallest = l;
		if (r < n && h[r]![0] < h[smallest]![0]) smallest = r;
		if (smallest === i) break;
		[h[i], h[smallest]] = [h[smallest]!, h[i]!];
		i = smallest;
	}
}
