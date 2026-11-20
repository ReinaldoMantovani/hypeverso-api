from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from trafilatura import extract

app = FastAPI(title="Hypeverso Article Extractor", version="1.3.0")


class ExtractRequest(BaseModel):
    html: str = Field(min_length=1, max_length=2_500_000)
    url: str | None = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "nexverse-article-extractor",
        "features": {"articleExtraction": True},
    }


@app.post("/extract")
def extract_article(payload: ExtractRequest):
    try:
        text = extract(
            payload.html,
            url=payload.url,
            output_format="txt",
            include_comments=False,
            include_tables=False,
            favor_precision=True,
            no_fallback=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Falha na extração: {exc}") from exc

    text = (text or "").strip()
    if len(text) < 100:
        raise HTTPException(status_code=422, detail="Conteúdo principal insuficiente")
    return {"text": text[:12000], "length": len(text)}
