from __future__ import annotations

from contextlib import asynccontextmanager
from io import BytesIO
import inspect
import logging
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

log = logging.getLogger("nexverse-moderator")

MAX_BYTES = 15 * 1024 * 1024
BLOCK_THRESHOLD = 0.60
BLOCKED_CLASSES = {
    "BUTTOCKS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "ANUS_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
}

_detector: Any | None = None
_detect_supports_thresholds = False


def _supports_threshold_kwargs(detector: Any) -> bool:
    """Detecta compatibilidade da API sem assumir a versão do NudeNet.

    NudeNet 3.4.2 expõe ``detect(image)``. Algumas implementações mais novas
    adicionaram ``score_threshold`` e ``nms_threshold``. O Hypeverso funciona
    com ambos os formatos e aplica a política final fora do detector.
    """
    try:
        params = inspect.signature(detector.detect).parameters
        return "score_threshold" in params and "nms_threshold" in params
    except (TypeError, ValueError):
        return False


def _detect(detector: Any, image_bytes: bytes) -> list[dict[str, Any]]:
    if _detect_supports_thresholds:
        return detector.detect(image_bytes, score_threshold=0.35, nms_threshold=0.5)
    # NudeNet 3.4.2: sem kwargs de threshold. A filtragem é feita abaixo pela
    # política do Hypeverso usando o score retornado por cada detecção.
    return detector.detect(image_bytes)


def load_detector() -> Any:
    """Carrega o modelo e executa uma inferência neutra de autodiagnóstico."""
    global _detect_supports_thresholds
    from nudenet import NudeDetector

    detector = NudeDetector()
    _detect_supports_thresholds = _supports_threshold_kwargs(detector)
    log.info(
        "NudeNet carregado; thresholds nativos=%s",
        _detect_supports_thresholds,
    )

    # O health só ficará verde se a inferência ONNX também funcionar, não apenas
    # se o módulo importar. Isso detecta incompatibilidades de runtime na subida.
    probe = BytesIO()
    Image.new("RGB", (64, 64), (240, 240, 240)).save(probe, format="PNG")
    _detect(detector, probe.getvalue())
    return detector


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _detector
    try:
        log.info("Carregando detector local NudeNet/ONNX...")
        _detector = load_detector()
        log.info("Detector local carregado com sucesso")
    except Exception:
        log.exception("Falha ao inicializar o detector local")
        # Faz o container falhar de verdade. Com restart: unless-stopped, o Docker
        # tenta novamente e o health nunca anuncia um serviço que não modera.
        raise
    yield
    _detector = None


app = FastAPI(title="Hypeverso Image Moderator", version="2.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    if _detector is None:
        raise HTTPException(status_code=503, detail="moderator-not-ready")
    return {
        "status": "ok",
        "service": "nexverse-image-moderator",
        "ready": True,
        "engine": "nudenet-3.4.2",
        "runtime": "onnxruntime-cpu",
        "thresholdMode": "native" if _detect_supports_thresholds else "nexverse-policy",
        "blockThreshold": BLOCK_THRESHOLD,
    }


@app.post("/moderate-image")
async def moderate_image(file: UploadFile = File(...)):
    if _detector is None:
        raise HTTPException(status_code=503, detail="moderator-not-ready")

    data = await file.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Imagem ausente")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Imagem excede 15 MB")

    try:
        with Image.open(BytesIO(data)) as image:
            if getattr(image, "is_animated", False) and getattr(image, "n_frames", 1) > 1:
                return {
                    "allowed": False,
                    "riskScore": 1.0,
                    "model": "format-safety",
                    "policy": "static-images-only",
                }
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=415, detail="Arquivo de imagem inválido") from exc

    try:
        # NudeNet 3.4.2 aceita bytes diretamente, porém sua assinatura é
        # detect(image) sem kwargs de threshold. A função de compatibilidade
        # acima também aceita versões que suportem thresholds nativos.
        detections = _detect(_detector, data)
    except Exception as exc:
        log.exception("Falha durante inferência de moderação")
        raise HTTPException(status_code=503, detail="Falha temporária na inferência do moderador") from exc

    scores = [
        float(item.get("score", 0.0))
        for item in detections
        if str(item.get("class", "")) in BLOCKED_CLASSES
    ]
    risk = max(scores, default=0.0)

    return {
        "allowed": risk < BLOCK_THRESHOLD,
        "riskScore": round(risk, 4),
        "model": "nudenet-320n",
        "policy": "no-explicit-nudity",
    }
