# Use the official Playwright Python image — it includes Chromium and all
# system-level dependencies (fonts, codecs, shared libs) required for
# headless browser automation. Building from a base Python image would
# require manually installing these, which is error-prone.
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app

# Install Python dependencies first (separate layer for caching).
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (Chromium only — reduces image size).
RUN playwright install chromium

# Copy backend source files.
COPY backend/ .

EXPOSE 8080

# Use uvicorn directly for production.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
