import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import type { GenerateResult } from "../types.js";

// Approximate Vertex AI pricing (USD).
// gemini-2.5-flash-lite: $0.10/1M input tokens, $0.40/1M output tokens
// text-embedding-005: $0.000025/1K characters
const PRICE_INPUT_PER_TOKEN = 0.1 / 1_000_000;
const PRICE_OUTPUT_PER_TOKEN = 0.4 / 1_000_000;
const PRICE_EMBED_PER_CHAR = 0.000025 / 1_000;

// text-embedding-005 limits: 250 instances/request, ~30k chars/request
const MAX_TEXTS_PER_BATCH = 250;
const MAX_CHARS_PER_BATCH = 30_000;

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
	if (!_client) {
		_client = new GoogleGenAI({
			vertexai: true,
			project: config.googleCloudProject,
			location: config.googleCloudLocation,
		});
	}
	return _client;
}

function makeBatches(texts: string[]): string[][] {
	const batches: string[][] = [];
	let current: string[] = [];
	let currentChars = 0;
	for (const text of texts) {
		const n = text.length;
		if (
			current.length > 0 &&
			(currentChars + n > MAX_CHARS_PER_BATCH ||
				current.length >= MAX_TEXTS_PER_BATCH)
		) {
			batches.push(current);
			current = [text];
			currentChars = n;
		} else {
			current.push(text);
			currentChars += n;
		}
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

export async function embedTexts(
	texts: string[],
	taskType: string = "RETRIEVAL_DOCUMENT",
): Promise<number[][]> {
	const client = getClient();
	const batches = makeBatches(texts);
	const results: number[][] = [];

	for (const batch of batches) {
		const response = await client.models.embedContent({
			model: config.embeddingModel,
			contents: batch,
			config: {
				taskType: taskType as "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
			},
		});
		if (!response.embeddings) throw new Error("No embeddings returned");
		for (const emb of response.embeddings) {
			results.push(emb.values ?? []);
		}
	}

	return results;
}

export async function embedQuery(text: string): Promise<number[]> {
	const embeddings = await embedTexts([text], "RETRIEVAL_QUERY");
	return embeddings[0] ?? [];
}

export async function generateText(prompt: string): Promise<GenerateResult> {
	const client = getClient();
	const response = await client.models.generateContent({
		model: config.generationModel,
		contents: prompt,
	});

	const usage = response.usageMetadata;
	const inputTokens = usage?.promptTokenCount ?? 0;
	const outputTokens = usage?.candidatesTokenCount ?? 0;
	const costUsd =
		inputTokens * PRICE_INPUT_PER_TOKEN + outputTokens * PRICE_OUTPUT_PER_TOKEN;

	return {
		text: response.text ?? "",
		inputTokens,
		outputTokens,
		costUsd,
	};
}

export function embedCost(texts: string[]): number {
	return texts.reduce((sum, t) => sum + t.length, 0) * PRICE_EMBED_PER_CHAR;
}

// Cosine similarity between two vectors (no external dep)
export function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

export function vecNorm(v: number[]): number {
	return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}
