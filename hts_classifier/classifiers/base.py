from abc import ABC, abstractmethod

from ..core.models import ClassifyResponse


class BaseClassifier(ABC):
    @abstractmethod
    async def classify(self, description: str, top_k: int) -> ClassifyResponse:
        ...
