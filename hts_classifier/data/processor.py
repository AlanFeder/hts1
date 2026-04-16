import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class HTSEntry:
    """Flat entry used for embeddings index and BM25."""
    hts_code: str
    description: str
    indent: int
    path: list[str]
    path_string: str
    general_rate: str


@dataclass
class HTSNode:
    """Tree node used by the agentic classifier."""
    index: int
    hts_code: str
    description: str
    indent: int
    path: list[str]
    general_rate: str
    children: list["HTSNode"] = field(default_factory=list)


def build_tree_and_flat(
    raw: list[dict],
) -> tuple[list[HTSEntry], dict[str, list[HTSNode]]]:
    """
    Process raw HTS JSON into:
    - flat_entries: all entries with an hts_code (for embeddings + BM25)
    - chapters: 2-digit chapter code -> list of indent=0 heading nodes with children attached

    Tree building is O(n) using a parent stack.
    The indent field is a string (occasionally zero-padded) — cast to int.
    """
    path_stack: dict[int, str] = {}
    node_stack: list[HTSNode] = []
    all_nodes: list[HTSNode] = []

    for item in raw:
        raw_indent = item.get("indent", "0")
        indent = int(raw_indent)
        desc = (item.get("description") or "").strip()
        if not desc:
            continue

        # Maintain rolling path
        path_stack[indent] = desc
        for k in list(path_stack.keys()):
            if k > indent:
                del path_stack[k]
        full_path = [path_stack[k] for k in sorted(path_stack.keys())]

        hts_code = (item.get("htsno") or "").strip()

        node = HTSNode(
            index=len(all_nodes),
            hts_code=hts_code,
            description=desc,
            indent=indent,
            path=full_path.copy(),
            general_rate=(item.get("general") or "").strip(),
        )
        all_nodes.append(node)

        # Attach to parent: pop stack until we find a node with strictly lower indent
        while node_stack and node_stack[-1].indent >= indent:
            node_stack.pop()
        if node_stack:
            node_stack[-1].children.append(node)
        node_stack.append(node)

    # Flat entries: only nodes with real HTS codes
    flat_entries = [
        HTSEntry(
            hts_code=n.hts_code,
            description=n.description,
            indent=n.indent,
            path=n.path,
            path_string=" > ".join(n.path),
            general_rate=n.general_rate,
        )
        for n in all_nodes
        if n.hts_code
    ]

    # Chapter groupings: indent=0 nodes grouped by 2-digit prefix
    chapters: dict[str, list[HTSNode]] = {}
    for n in all_nodes:
        if n.indent == 0 and n.hts_code:
            ch = n.hts_code[:2]
            chapters.setdefault(ch, []).append(n)

    return flat_entries, chapters


def save_flat_entries(entries: list[HTSEntry], path: str = "data/hts_processed.json") -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(
            [
                {
                    "hts_code": e.hts_code,
                    "description": e.description,
                    "indent": e.indent,
                    "path": e.path,
                    "path_string": e.path_string,
                    "general_rate": e.general_rate,
                }
                for e in entries
            ]
        )
    )


def load_flat_entries(path: str = "data/hts_processed.json") -> list[HTSEntry]:
    data = json.loads(Path(path).read_text())
    return [HTSEntry(**d) for d in data]


def load_or_process(
    raw: list[dict],
    processed_path: str = "data/hts_processed.json",
) -> tuple[list[HTSEntry], dict[str, list[HTSNode]]]:
    """
    Load flat entries from cache if available, otherwise process raw and save.
    The chapter tree is always rebuilt from raw (fast, O(n), not worth persisting).
    """
    _, chapters = build_tree_and_flat(raw)

    p = Path(processed_path)
    if p.exists():
        flat_entries = load_flat_entries(processed_path)
    else:
        flat_entries, _ = build_tree_and_flat(raw)
        save_flat_entries(flat_entries, processed_path)

    return flat_entries, chapters
