from abc import ABC, abstractmethod

from ..core.models import ClassifyResponse


class BaseClassifier(ABC):
    @abstractmethod
    async def classify(
        self,
        description: str,
        top_k: int,
        path_weight: float | None = None,
        candidate_pool: int | None = None,
        beam_width: int | None = None,
    ) -> ClassifyResponse: ...
