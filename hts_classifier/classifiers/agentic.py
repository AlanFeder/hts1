import json
import re

import numpy as np
from loguru import logger

from ..core.config import settings
from ..core.models import ClassifyResponse, HTSResult
from ..data.processor import HTSNode
from ..services.vertex import embed_cost, embed_query, embed_texts, generate_text
from .base import BaseClassifier

_SELECT_PROMPT = """You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Select the {n} most relevant categories from this numbered list:
{options}

Return ONLY a JSON array of the line numbers (1-indexed). Example: [3, 7, 12]"""

_CHAPTER_PROMPT = """You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Select the {n} most relevant chapters from this list:
{options}

Return ONLY a JSON array of chapter codes (2-digit strings). Example: ["85", "84"]"""

_STEP_PROMPT = """You are an HTS (Harmonized Tariff Schedule) tariff classification expert.

Product to classify: "{description}"

Evaluate each HTS node below. For each relevant node, decide:
- explore: drill into its subcategories next round
- finalize: this is the correct classification for the product (use even if subcodes exist)
- omit: not relevant, prune it

Nodes marked [LEAF] have no subcategories — finalize or omit only.

{options}

Return ONLY a JSON object with two lists of 1-indexed line numbers:
{{"explore": [...], "finalize": [...]}}
Example: {{"explore": [2, 5], "finalize": [8]}}"""


# When beam exceeds this, embedding-prefilter before showing to LLM.
# Below this threshold, LLM sees everything unfiltered.
_MAX_DISPLAY = 50


async def _embeddings_prefilter(
    description: str, nodes: list[HTSNode], n: int
) -> tuple[list[HTSNode], float]:
    """Filter nodes by cosine similarity to the query. Returns (filtered_nodes, cost_usd)."""
    texts = [" ".join(nd.path) + " " + nd.description for nd in nodes]
    query_emb = await embed_query(description)
    node_embs = await embed_texts(texts, task_type="RETRIEVAL_DOCUMENT")

    q = np.array(query_emb)
    N = np.array(node_embs)
    q_unit = q / np.linalg.norm(q)
    n_units = N / np.linalg.norm(N, axis=1, keepdims=True)
    scores = n_units @ q_unit

    top_idx = np.argsort(scores)[::-1][:n]
    cost = embed_cost([description] + texts)
    return [nodes[int(i)] for i in top_idx], cost


def _format_node(node: HTSNode) -> str:
    code = f"[{node.hts_code}] " if node.hts_code else ""
    return f"{code}{node.description}"


def _format_beam_node(i: int, node: HTSNode) -> str:
    tag = "[LEAF]" if not node.children else "[HAS SUBCODES]"
    code = f"[{node.hts_code}] " if node.hts_code else ""
    if len(node.path) > 1:
        parent_path = " > ".join(node.path[:-1][-2:])
        return f"{i}. {code}{node.description} {tag}\n   (under: {parent_path})"
    return f"{i}. {code}{node.description} {tag}"


def _parse_int_list(text: str) -> list[int]:
    match = re.search(r"\[.*?\]", text, re.DOTALL)
    if match:
        try:
            return [int(x) for x in json.loads(match.group())]
        except (json.JSONDecodeError, ValueError):
            pass
    return [int(x) for x in re.findall(r"\b\d+\b", text)]


def _parse_str_list(text: str) -> list[str]:
    match = re.search(r"\[.*?\]", text, re.DOTALL)
    if match:
        try:
            return [str(x) for x in json.loads(match.group())]
        except (json.JSONDecodeError, ValueError):
            pass
    return re.findall(r'"([^"]+)"', text)


def _parse_explore_finalize(text: str) -> tuple[list[int], list[int]]:
    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            explore = [int(x) for x in data.get("explore", [])]
            finalize = [int(x) for x in data.get("finalize", [])]
            return explore, finalize
        except (json.JSONDecodeError, ValueError):
            pass
    return [], []


class AgenticClassifier(BaseClassifier):
    """
    Layer-by-layer HTS tree traversal with LLM explore/finalize decisions.

    Flow:
    1. Show LLM all chapters (~99), pick beam_width chapters.
    2. Collect all heading nodes from selected chapters (no BM25 prefilter).
    3. At each depth: show ALL current beam nodes to LLM, which decides:
       - explore: expand this node's children into the next beam
       - finalize: accept this as a final answer (even if it has subcodes)
       - omit: prune
    4. Leaves that are explored are auto-finalized (can't go deeper).
    5. Accumulate finalized nodes across all depths into final_pool.
    6. Final LLM ranking of final_pool → top_k results.
    """

    def __init__(
        self,
        chapters: dict[str, list[HTSNode]],
        beam_width: int | None = None,
    ) -> None:
        self._chapters = chapters
        self._beam_width = beam_width or settings.beam_width

    async def classify(
        self,
        description: str,
        top_k: int = 5,
        path_weight: float | None = None,
        candidate_pool: int | None = None,
        beam_width: int | None = None,
    ) -> ClassifyResponse:
        bw = beam_width if beam_width is not None else self._beam_width
        logger.info(f"agentic | query={description!r} top_k={top_k} beam_width={bw}")
        beam_steps: list[dict] = []
        final_pool: list[HTSNode] = []
        total_cost = 0.0

        # Step 1: chapter selection
        chapter_lines = []
        sorted_chapters = sorted(self._chapters.items())
        for ch, nodes in sorted_chapters:
            sample = ", ".join(n.description.rstrip(":") for n in nodes[:3])
            chapter_lines.append(f"{ch}: {sample}…")

        ch_result = await generate_text(
            _CHAPTER_PROMPT.format(
                description=description,
                n=bw,
                options="\n".join(chapter_lines),
            )
        )
        total_cost += ch_result.cost_usd
        selected_ch_codes = _parse_str_list(ch_result.text)
        logger.info(f"agentic | selected chapters: {selected_ch_codes}")
        beam_steps.append(
            {
                "step": "chapter_selection",
                "selected": selected_ch_codes,
                "llm_response": ch_result.text,
            }
        )

        # Collect all heading nodes from selected chapters (no BM25 prefilter)
        beam: list[HTSNode] = []
        for sel in selected_ch_codes:
            key = re.sub(r"\D", "", sel)[:2].zfill(2)
            beam.extend(self._chapters.get(key, []))

        if not beam:
            for _, nodes in sorted_chapters[:bw]:
                beam.extend(nodes)

        # Step 2+: layer-by-layer explore/finalize
        for depth in range(12):
            if not beam:
                break

            # Soft cap: if beam is too large, embedding-prefilter before showing to LLM
            display_beam = beam
            if len(beam) > _MAX_DISPLAY:
                display_beam, filter_cost = await _embeddings_prefilter(
                    description, beam, _MAX_DISPLAY
                )
                total_cost += filter_cost
                logger.info(
                    f"agentic | depth={depth} beam={len(beam)} > {_MAX_DISPLAY}, embedding-filtered to {len(display_beam)}"
                )

            options = "\n".join(
                _format_beam_node(i + 1, n) for i, n in enumerate(display_beam)
            )
            step_result = await generate_text(
                _STEP_PROMPT.format(description=description, options=options)
            )
            total_cost += step_result.cost_usd

            explore_indices, finalize_indices = _parse_explore_finalize(
                step_result.text
            )

            explored = [
                display_beam[i - 1]
                for i in explore_indices
                if 0 < i <= len(display_beam)
            ]
            finalized = [
                display_beam[i - 1]
                for i in finalize_indices
                if 0 < i <= len(display_beam)
            ]

            # Fallback: if nothing was selected (parse failed or all indices out of range)
            if not explored and not finalized:
                logger.warning(
                    f"agentic | depth={depth} no valid selections from LLM response, finalizing first {bw} nodes"
                )
                finalized = display_beam[:bw]

            final_pool.extend(finalized)
            logger.info(
                f"agentic | depth={depth} beam_size={len(beam)}"
                f" explored={[_format_node(n) for n in explored]}"
                f" finalized={[_format_node(n) for n in finalized]}"
            )
            beam_steps.append(
                {
                    "step": f"depth_{depth}",
                    "beam_size": len(beam),
                    "explored": [_format_node(n) for n in explored],
                    "finalized": [_format_node(n) for n in finalized],
                    "llm_response": step_result.text,
                }
            )

            next_beam: list[HTSNode] = []
            for node in explored:
                if node.children:
                    next_beam.extend(node.children)
                else:
                    # Leaf marked as explore → finalize instead
                    final_pool.append(node)

            beam = next_beam

        # Anything left in beam at max depth → finalize
        final_pool.extend(beam)

        # Final ranking
        if len(final_pool) > top_k:
            options = "\n".join(
                f"{i + 1}. {_format_node(n)}" for i, n in enumerate(final_pool)
            )
            final_result = await generate_text(
                _SELECT_PROMPT.format(description=description, n=top_k, options=options)
            )
            total_cost += final_result.cost_usd
            indices = _parse_int_list(final_result.text)
            final = [final_pool[i - 1] for i in indices if 0 < i <= len(final_pool)]
            if not final:
                final = final_pool[:top_k]
            final_llm_response = final_result.text
        else:
            final = final_pool
            final_llm_response = ""

        final_descs = [_format_node(n) for n in final]
        logger.info(
            f"agentic | final results: {final_descs} total_cost=${total_cost:.6f}"
        )
        beam_steps.append(
            {
                "step": "final_ranking",
                "pool_size": len(final_pool),
                "selected": final_descs,
                "llm_response": final_llm_response,
            }
        )

        return ClassifyResponse(
            results=[
                HTSResult(
                    hts_code=n.hts_code,
                    description=n.description,
                    path=n.path,
                    score=1.0 / (rank + 1),
                    general_rate=n.general_rate,
                )
                for rank, n in enumerate(final[:top_k])
            ],
            method="agentic",
            query=description,
            cost_usd=total_cost,
            intermediates={"beam_steps": beam_steps},
        )
