FROM python:3.12-slim

WORKDIR /app

# System dependencies for xhtml2pdf → svglib → rlpycairo → pycairo
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    ffmpeg \
    libcairo2-dev \
    libxcb1-dev \
    pkg-config \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create audio storage directory
RUN mkdir -p /app/audio_files

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
