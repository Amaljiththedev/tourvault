# TourVault API image.
# Build:  docker build -t tourvault-api .
# Run:    docker run --rm -p 8001:8001 tourvault-api

# Slim image: Debian with Python only, no compilers or extras, so it is smaller
# and has fewer packages that could carry security holes.
FROM python:3.14-slim

# Don't write .pyc files, and print logs straight away instead of buffering them.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy requirements on their own first. Docker caches each step, so when only
# app code changes, this slow install step is reused instead of re-run.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The code changes most often, so it is copied last.
COPY app/ ./app/

# Run as an unprivileged user: if the app is ever compromised, the attacker
# is not root inside the container.
RUN useradd --create-home appuser
USER appuser

EXPOSE 8001

# 0.0.0.0 listens on every network interface in the container. 127.0.0.1 would
# only accept connections from inside the container itself, so the published
# port could never reach it. No --reload: that is a development feature.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
