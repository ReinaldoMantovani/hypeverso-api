FROM python:3.15-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
COPY services/extractor/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/extractor/app.py ./app.py
EXPOSE 8095
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8095", "--workers", "1"]
