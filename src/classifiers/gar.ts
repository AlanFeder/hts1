import { generateText } from "../services/vertex.js";
import type { ClassifyResponse, HTSEntry } from "../types.js";

const PROMPT = `You are an expert in HTS (Harmonized Tariff Schedule) tariff classification.

Given a product description, generate 5 alternative search phrases that could help find this product in the HTS. Include technical/trade terms, material composition, function, and industry sector.

Product description: {description}

Respond with ONLY a JSON array of strings, no explanation.
Example: ["smartphones", "mobile phones", "telephone handsets", "wireless communication devices", "cellular telephones"]`;

// ─── BM25 Okapi implementation ────────────────────────────────────────────────

function tokenize(text: string): string[] {
	return text.toLowerCase().split(/\s+/).filter(Boolean);
}

class BM25 {
	private readonly k1 = 1.5;
	private readonly b = 0.75;
	private readonly avgdl: number;
	private readonly idf = new Map<string, number>();
	private readonly corpus: string[][];

	constructor(corpus: string[][]) {
		this.corpus = corpus;
		this.avgdl =
			corpus.reduce((s, d) => s + d.length, 0) / (corpus.length || 1);

		const N = corpus.length;
		const df = new Map<string, number>();
		for (const doc of corpus) {
			for (const term of new Set(doc)) {
				df.set(term, (df.get(term) ?? 0) + 1);
			}
		}
		for (const [term, freq] of df) {
			this.idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
		}
	}

	getScores(query: string[]): Float64Array {
		const scores = new Float64Array(this.corpus.length);
		for (let docIdx = 0; docIdx < this.corpus.length; docIdx++) {
			const doc = this.corpus[docIdx] ?? [];
			const tf = new Map<string, number>();
			for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
			const dl = doc.length;

			let score = 0;
			for (const term of query) {
				const idf = this.idf.get(term) ?? 0;
				if (idf === 0) continue;
				const freq = tf.get(term) ?? 0;
				score +=
					(idf * (freq * (this.k1 + 1))) /
					(freq + this.k1 * (1 - this.b + (this.b * dl) / this.avgdl));
			}
			scores[docIdx] = score;
		}
		return scores;
	}
}

// ─── Classifier ───────────────────────────────────────────────────────────────

export class GARClassifier {
	private bm25: BM25;

	constructor(private entries: HTSEntry[]) {
		const corpus = entries.map((e) => tokenize(e.path_string));
		this.bm25 = new BM25(corpus);
	}

	async classify(
		description: string,
		topK: number = 5,
	): Promise<ClassifyResponse> {
		console.info(`gar | query=${JSON.stringify(description)} top_k=${topK}`);

		const result = await generateText(
			PROMPT.replace("{description}", description),
		);
		console.debug(
			`gar | raw LLM response: ${result.text} tokens=${result.inputTokens}+${result.outputTokens} cost=$${result.costUsd.toFixed(6)}`,
		);

		const expandedTerms: string[] = [description];
		const match = result.text.match(/\[[\s\S]*?\]/);
		if (match) {
			try {
				const parsed = JSON.parse(match[0]) as string[];
				expandedTerms.push(...parsed);
			} catch {
				console.warn("gar | failed to parse expanded terms from LLM response");
			}
		}

		console.info(`gar | expanded_terms=${JSON.stringify(expandedTerms)}`);

		const combinedQuery = tokenize(expandedTerms.join(" "));
		const rawScores = this.bm25.getScores(combinedQuery);

		// Pair each entry with its score, sort descending, take top-k
		const ranked = this.entries
			.map((entry, i) => ({ entry, score: rawScores[i] ?? 0 }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);

		const maxScore = ranked[0]?.score || 1;

		for (const { entry, score } of ranked) {
			console.info(
				`gar | bm25_score=${score.toFixed(4)} (norm=${(score / maxScore).toFixed(4)}) hts=${entry.hts_code} desc=${JSON.stringify(entry.description)}`,
			);
		}

		return {
			results: ranked.map(({ entry, score }) => ({
				hts_code: entry.hts_code,
				description: entry.description,
				path: entry.path,
				score: score / maxScore,
				general_rate: entry.general_rate || null,
			})),
			method: "gar",
			query: description,
			cost_usd: result.costUsd,
			intermediates: {
				expanded_terms: expandedTerms,
				llm_raw_response: result.text,
				bm25_scores: ranked.map(({ entry, score }) => ({
					hts_code: entry.hts_code,
					description: entry.description,
					raw_score: score,
					normalized_score: score / maxScore,
				})),
			},
		};
	}
}
