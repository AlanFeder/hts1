import { readFileSync } from "fs";
import type { HTSEntry, HTSNode, ChapterMap } from "../types.js";

export function loadFlatEntries(path: string): HTSEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as HTSEntry[];
  return raw;
}

export function buildTreeAndFlat(raw: Record<string, unknown>[]): {
  flatEntries: HTSEntry[];
  chapters: ChapterMap;
} {
  const pathStack = new Map<number, string>();
  const nodeStack: HTSNode[] = [];
  const allNodes: HTSNode[] = [];

  for (const item of raw) {
    const rawIndent = item["indent"] ?? "0";
    const indent = parseInt(String(rawIndent), 10);
    const desc = (String(item["description"] ?? "")).trim();
    if (!desc) continue;

    pathStack.set(indent, desc);
    // prune deeper levels from stack
    for (const k of pathStack.keys()) {
      if (k > indent) pathStack.delete(k);
    }
    const fullPath = [...pathStack.keys()].sort((a, b) => a - b).map((k) => pathStack.get(k)!);

    const hts_code = (String(item["htsno"] ?? "")).trim();

    const node: HTSNode = {
      index: allNodes.length,
      hts_code,
      description: desc,
      indent,
      path: [...fullPath],
      general_rate: (String(item["general"] ?? "")).trim(),
      children: [],
    };
    allNodes.push(node);

    // Attach to parent: pop until we find a node with strictly lower indent
    while (nodeStack.length > 0 && nodeStack[nodeStack.length - 1]!.indent >= indent) {
      nodeStack.pop();
    }
    if (nodeStack.length > 0) {
      nodeStack[nodeStack.length - 1]!.children.push(node);
    }
    nodeStack.push(node);
  }

  // Flat entries: only nodes with real HTS codes
  const flatEntries: HTSEntry[] = allNodes
    .filter((n) => n.hts_code)
    .map((n) => ({
      hts_code: n.hts_code,
      description: n.description,
      indent: n.indent,
      path: n.path,
      path_string: n.path.join(" > "),
      general_rate: n.general_rate,
    }));

  // Chapter groupings: indent=0 nodes grouped by 2-digit prefix
  const chapters: ChapterMap = new Map();
  for (const n of allNodes) {
    if (n.indent === 0 && n.hts_code) {
      const ch = n.hts_code.slice(0, 2);
      if (!chapters.has(ch)) chapters.set(ch, []);
      chapters.get(ch)!.push(n);
    }
  }

  return { flatEntries, chapters };
}

export function loadOrProcess(
  rawPath: string,
  processedPath: string
): { flatEntries: HTSEntry[]; chapters: ChapterMap } {
  const raw = JSON.parse(readFileSync(rawPath, "utf8")) as Record<string, unknown>[];

  // Always rebuild the tree (fast, O(n), not worth persisting)
  const { chapters } = buildTreeAndFlat(raw);

  // Load flat entries from cache if available
  const flatEntries = loadFlatEntries(processedPath);

  return { flatEntries, chapters };
}
