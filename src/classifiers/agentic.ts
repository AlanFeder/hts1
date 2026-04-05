import { embedQuery, embedTexts, embedCost, generateText, cosineSimilarity } from "../services/vertex.js";
import { config } from "../config.js";
import type { HTSNode, ChapterMap, ClassifyResponse } from "../types.js";

const SELECT_PROMPT = `You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Select the {n} most relevant categories from this numbered list:
{options}

Return ONLY a JSON array of the line numbers (1-indexed). Example: [3, 7, 12]`;

const CHAPTER_PROMPT = `You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Select the {n} most relevant chapters from this list:
{options}

Return ONLY a JSON array of chapter codes (2-digit strings). Example: ["85", "84"]`;

const STEP_PROMPT = `You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Evaluate each HTS node below. For each relevant node, decide:
- explore: drill into its subcategories next round
- finalize: this is the correct classification for the product (use even if subcodes exist)
- omit: not relevant, prune it

Nodes marked [LEAF] have no subcategories — finalize or omit only.

{options}

Return ONLY a JSON object with two lists of 1-indexed line numbers:
{"explore": [...], "finalize": [...]}
Example: {"explore": [2, 5], "finalize": [8]}`;

// When beam exceeds this, embedding-prefilter before showing to LLM
const MAX_DISPLAY = 50;

function formatNode(node: HTSNode): string {
  const code = node.hts_code ? `[${node.hts_code}] ` : "";
  return `${code}${node.description}`;
}

function formatBeamNode(i: number, node: HTSNode): string {
  const tag = node.children.length === 0 ? "[LEAF]" : "[HAS SUBCODES]";
  const code = node.hts_code ? `[${node.hts_code}] ` : "";
  if (node.path.length > 1) {
    const parentPath = node.path.slice(-3, -1).join(" > ");
    return `${i}. ${code}${node.description} ${tag}\n   (under: ${parentPath})`;
  }
  return `${i}. ${code}${node.description} ${tag}`;
}

function parseIntList(text: string): number[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      return (JSON.parse(match[0]) as number[]).map(Number);
    } catch {
      // fall through
    }
  }
  return [...text.matchAll(/\b\d+\b/g)].map((m) => parseInt(m[0], 10));
}

function parseStrList(text: string): string[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      return (JSON.parse(match[0]) as string[]).map(String);
    } catch {
      // fall through
    }
  }
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

function parseExploreFinalize(text: string): { explore: number[]; finalize: number[] } {
  const match = text.match(/\{[^{}]*\}/s);
  if (match) {
    try {
      const data = JSON.parse(match[0]) as { explore?: number[]; finalize?: number[] };
      return {
        explore: (data.explore ?? []).map(Number),
        finalize: (data.finalize ?? []).map(Number),
      };
    } catch {
      // fall through
    }
  }
  return { explore: [], finalize: [] };
}

async function embeddingsPrefilter(
  description: string,
  nodes: HTSNode[],
  n: number
): Promise<{ filtered: HTSNode[]; cost: number }> {
  const texts = nodes.map((nd) => nd.path.join(" ") + " " + nd.description);
  const [queryEmb, nodeEmbs] = await Promise.all([
    embedQuery(description),
    embedTexts(texts, "RETRIEVAL_DOCUMENT"),
  ]);

  const scored = nodes.map((node, i) => ({
    node,
    score: cosineSimilarity(queryEmb, nodeEmbs[i]!),
  }));
  scored.sort((a, b) => b.score - a.score);

  return {
    filtered: scored.slice(0, n).map((s) => s.node),
    cost: embedCost([description, ...texts]),
  };
}

export class AgenticClassifier {
  constructor(
    private chapters: ChapterMap,
    private beamWidth: number = config.beamWidth
  ) {}

  async classify(
    description: string,
    topK: number = 5,
    beamWidth: number | null = null
  ): Promise<ClassifyResponse> {
    const bw = beamWidth ?? this.beamWidth;
    console.info(`agentic | query=${JSON.stringify(description)} top_k=${topK} beam_width=${bw}`);

    const beamSteps: Record<string, unknown>[] = [];
    const finalPool: HTSNode[] = [];
    let totalCost = 0;

    // Step 1: Chapter selection
    const sortedChapters = [...this.chapters.entries()].sort(([a], [b]) => a.localeCompare(b));
    const chapterLines = sortedChapters.map(([ch, nodes]) => {
      const sample = nodes
        .slice(0, 3)
        .map((n) => n.description.replace(/:$/, ""))
        .join(", ");
      return `${ch}: ${sample}…`;
    });

    const chResult = await generateText(
      CHAPTER_PROMPT
        .replace("{description}", description)
        .replace("{n}", String(bw))
        .replace("{options}", chapterLines.join("\n"))
    );
    totalCost += chResult.costUsd;

    const selectedChCodes = parseStrList(chResult.text);
    console.info(`agentic | selected chapters: ${JSON.stringify(selectedChCodes)}`);
    beamSteps.push({
      step: "chapter_selection",
      selected: selectedChCodes,
      llm_response: chResult.text,
    });

    // Collect all heading nodes from selected chapters
    let beam: HTSNode[] = [];
    for (const sel of selectedChCodes) {
      const key = sel.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
      beam.push(...(this.chapters.get(key) ?? []));
    }

    // Fallback: use first bw chapters if none matched
    if (beam.length === 0) {
      for (const [, nodes] of sortedChapters.slice(0, bw)) {
        beam.push(...nodes);
      }
    }

    // Step 2+: Layer-by-layer explore/finalize
    for (let depth = 0; depth < 12; depth++) {
      if (beam.length === 0) break;

      let displayBeam = beam;
      if (beam.length > MAX_DISPLAY) {
        const { filtered, cost } = await embeddingsPrefilter(description, beam, MAX_DISPLAY);
        totalCost += cost;
        displayBeam = filtered;
        console.info(
          `agentic | depth=${depth} beam=${beam.length} > ${MAX_DISPLAY}, embedding-filtered to ${displayBeam.length}`
        );
      }

      const options = displayBeam
        .map((n, i) => formatBeamNode(i + 1, n))
        .join("\n");

      const stepResult = await generateText(
        STEP_PROMPT
          .replace("{description}", description)
          .replace("{options}", options)
      );
      totalCost += stepResult.costUsd;

      const { explore: exploreIndices, finalize: finalizeIndices } = parseExploreFinalize(stepResult.text);

      const explored = exploreIndices
        .filter((i) => i >= 1 && i <= displayBeam.length)
        .map((i) => displayBeam[i - 1]!);
      const finalized = finalizeIndices
        .filter((i) => i >= 1 && i <= displayBeam.length)
        .map((i) => displayBeam[i - 1]!);

      // Fallback: if nothing selected, finalize first bw nodes
      const effectiveExplored = explored;
      const effectiveFinalized = finalized;
      if (explored.length === 0 && finalized.length === 0) {
        console.warn(
          `agentic | depth=${depth} no valid selections from LLM response, finalizing first ${bw} nodes`
        );
        effectiveFinalized.push(...displayBeam.slice(0, bw));
      }

      finalPool.push(...effectiveFinalized);
      console.info(
        `agentic | depth=${depth} beam_size=${beam.length}` +
        ` explored=${JSON.stringify(effectiveExplored.map(formatNode))}` +
        ` finalized=${JSON.stringify(effectiveFinalized.map(formatNode))}`
      );
      beamSteps.push({
        step: `depth_${depth}`,
        beam_size: beam.length,
        explored: effectiveExplored.map(formatNode),
        finalized: effectiveFinalized.map(formatNode),
        llm_response: stepResult.text,
      });

      const nextBeam: HTSNode[] = [];
      for (const node of effectiveExplored) {
        if (node.children.length > 0) {
          nextBeam.push(...node.children);
        } else {
          // Leaf marked explore → auto-finalize
          finalPool.push(node);
        }
      }
      beam = nextBeam;
    }

    // Anything left in beam at max depth → finalize
    finalPool.push(...beam);

    // Final ranking
    let final: HTSNode[];
    let finalLlmResponse = "";

    if (finalPool.length > topK) {
      const options = finalPool
        .map((n, i) => `${i + 1}. ${formatNode(n)}`)
        .join("\n");
      const finalResult = await generateText(
        SELECT_PROMPT
          .replace("{description}", description)
          .replace("{n}", String(topK))
          .replace("{options}", options)
      );
      totalCost += finalResult.costUsd;
      finalLlmResponse = finalResult.text;

      const indices = parseIntList(finalResult.text);
      final = indices
        .filter((i) => i >= 1 && i <= finalPool.length)
        .map((i) => finalPool[i - 1]!);
      if (final.length === 0) final = finalPool.slice(0, topK);
    } else {
      final = finalPool;
    }

    const finalDescs = final.map(formatNode);
    console.info(`agentic | final results: ${JSON.stringify(finalDescs)} total_cost=$${totalCost.toFixed(6)}`);
    beamSteps.push({
      step: "final_ranking",
      pool_size: finalPool.length,
      selected: finalDescs,
      llm_response: finalLlmResponse,
    });

    return {
      results: final.slice(0, topK).map((n, rank) => ({
        hts_code: n.hts_code,
        description: n.description,
        path: n.path,
        score: 1.0 / (rank + 1),
        general_rate: n.general_rate || null,
      })),
      method: "agentic",
      query: description,
      cost_usd: totalCost,
      intermediates: { beam_steps: beamSteps },
    };
  }
}
