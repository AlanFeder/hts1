import json
import re

import numpy as np
from loguru import logger
from rank_bm25 import BM25Okapi

from ..core.config import settings
from ..core.models import ClassifyResponse, HTSResult
from ..data.processor import HTSNode
from ..services.vertex import generate_text
from .base import BaseClassifier

_MAX_CANDIDATES = 40

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


def _bm25_prefilter(query: str, nodes: list[HTSNode], n: int) -> list[HTSNode]:
    if len(nodes) <= n:
        return nodes
    texts = [(" ".join(nd.path) + " " + nd.description).lower().split() for nd in nodes]
    bm25 = BM25Okapi(texts)
    scores = bm25.get_scores(query.lower().split())
    top_idx = np.argsort(scores)[::-1][:n]
    return [nodes[int(i)] for i in top_idx]


def _format_node(node: HTSNode) -> str:
    code = f"[{node.hts_code}] " if node.hts_code else ""
    return f"{code}{node.description}"


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


class AgenticClassifier(BaseClassifier):
    """
    Level-by-level beam search through the HTS tree.

    Flow:
    1. Show LLM all chapters (~99), pick beam_width.
    2. Collect heading nodes (indent=0) in selected chapters.
    3. BM25-prefilter to MAX_CANDIDATES, LLM picks beam_width.
    4. Expand children, repeat until all beam nodes are leaves.
    5. Final LLM ranking of top candidates.
    """

    def __init__(
        self,
        chapters: dict[str, list[HTSNode]],
        beam_width: int | None = None,
    ) -> None:
        self._chapters = chapters
        self._beam_width = beam_width or settings.beam_width

    async def classify(
        self, description: str, top_k: int = 5, path_weight: float | None = None
    ) -> ClassifyResponse:
        logger.info(
            f"agentic | query={description!r} top_k={top_k} beam_width={self._beam_width}"
        )
        beam_steps: list[dict] = []

        # Step 1: chapter selection
        chapter_lines = []
        sorted_chapters = sorted(self._chapters.items())
        for ch, nodes in sorted_chapters:
            sample = ", ".join(n.description.rstrip(":") for n in nodes[:3])
            chapter_lines.append(f"{ch}: {sample}…")

        response = await generate_text(
            _CHAPTER_PROMPT.format(
                description=description,
                n=self._beam_width,
                options="\n".join(chapter_lines),
            )
        )
        selected_ch_codes = _parse_str_list(response)
        logger.info(f"agentic | selected chapters: {selected_ch_codes}")
        beam_steps.append(
            {
                "step": "chapter_selection",
                "selected": selected_ch_codes,
                "llm_response": response,
            }
        )

        # Collect heading nodes for selected chapters
        heading_nodes: list[HTSNode] = []
        for sel in selected_ch_codes:
            key = re.sub(r"\D", "", sel)[:2].zfill(2)
            heading_nodes.extend(self._chapters.get(key, []))

        if not heading_nodes:
            for _, nodes in sorted_chapters[: self._beam_width]:
                heading_nodes.extend(nodes)

        beam: list[HTSNode] = _bm25_prefilter(
            description, heading_nodes, _MAX_CANDIDATES
        )

        # Step 2+: beam search
        for depth in range(12):
            non_leaves = [n for n in beam if n.children]
            if not non_leaves:
                logger.info(
                    f"agentic | depth={depth} all beam nodes are leaves, stopping"
                )
                break

            candidates = _bm25_prefilter(description, beam, _MAX_CANDIDATES)
            options = "\n".join(
                f"{i + 1}. {_format_node(n)}" for i, n in enumerate(candidates)
            )
            response = await generate_text(
                _SELECT_PROMPT.format(
                    description=description,
                    n=min(self._beam_width, len(candidates)),
                    options=options,
                )
            )
            indices = _parse_int_list(response)
            selected = [candidates[i - 1] for i in indices if 0 < i <= len(candidates)]
            if not selected:
                selected = candidates[: self._beam_width]

            selected_descs = [_format_node(n) for n in selected]
            logger.info(f"agentic | depth={depth} selected: {selected_descs}")
            beam_steps.append(
                {
                    "step": f"depth_{depth}",
                    "candidates_count": len(candidates),
                    "selected": selected_descs,
                    "llm_response": response,
                }
            )

            next_beam: list[HTSNode] = []
            for node in selected:
                if node.children:
                    next_beam.extend(node.children)
                else:
                    next_beam.append(node)

            if not next_beam:
                beam = selected
                break
            beam = next_beam

        # Final ranking
        final_candidates = _bm25_prefilter(
            description, beam, max(top_k * 2, _MAX_CANDIDATES)
        )
        if len(final_candidates) > top_k:
            options = "\n".join(
                f"{i + 1}. {_format_node(n)}" for i, n in enumerate(final_candidates)
            )
            response = await generate_text(
                _SELECT_PROMPT.format(description=description, n=top_k, options=options)
            )
            indices = _parse_int_list(response)
            final = [
                final_candidates[i - 1]
                for i in indices
                if 0 < i <= len(final_candidates)
            ]
            if not final:
                final = final_candidates[:top_k]
        else:
            final = final_candidates
            response = ""

        final_descs = [_format_node(n) for n in final]
        logger.info(f"agentic | final results: {final_descs}")
        beam_steps.append(
            {"step": "final_ranking", "selected": final_descs, "llm_response": response}
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
            intermediates={"beam_steps": beam_steps},
        )
