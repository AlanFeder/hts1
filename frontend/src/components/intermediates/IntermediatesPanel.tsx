import type {
  AgenticIntermediates,
  ClassifyResponse,
  EmbeddingsIntermediates,
  GarIntermediates,
  RerankIntermediates,
} from "../../types";
import AgenticIntermediatesPanel from "./AgenticIntermediates";
import EmbeddingsIntermediatesPanel from "./EmbeddingsIntermediates";
import GarIntermediatesPanel from "./GarIntermediates";
import RerankIntermediatesPanel from "./RerankIntermediates";

export default function IntermediatesPanel({
  response,
}: {
  response: ClassifyResponse;
}) {
  const int = response.intermediates;
  if (!int) {
    return (
      <p className="text-sm text-slate-400 italic">No intermediates available.</p>
    );
  }

  switch (response.method) {
    case "embeddings":
      return (
        <EmbeddingsIntermediatesPanel
          data={int as unknown as EmbeddingsIntermediates}
        />
      );
    case "gar":
      return (
        <GarIntermediatesPanel data={int as unknown as GarIntermediates} />
      );
    case "rerank":
      return (
        <RerankIntermediatesPanel data={int as unknown as RerankIntermediates} />
      );
    case "agentic":
      return (
        <AgenticIntermediatesPanel
          data={int as unknown as AgenticIntermediates}
        />
      );
    default:
      return (
        <pre className="text-xs bg-slate-100 rounded p-3 overflow-x-auto">
          {JSON.stringify(int, null, 2)}
        </pre>
      );
  }
}
