FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/runtime-data \
    PYTHON=/opt/venv/bin/python

EXPOSE 3000
CMD ["npm", "start"]
