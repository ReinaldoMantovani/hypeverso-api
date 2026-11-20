FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# libgomp é utilizado pelo ONNX Runtime; libglib cobre dependências comuns do
# OpenCV headless em Debian slim.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY services/moderator/requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
    && python -c "from io import BytesIO; from PIL import Image; from nudenet import NudeDetector; b=BytesIO(); Image.new('RGB',(32,32),(240,240,240)).save(b,format='PNG'); NudeDetector().detect(b.getvalue()); print('NudeNet inference OK')"
COPY services/moderator/app.py ./app.py
EXPOSE 8096
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8096", "--workers", "1"]
