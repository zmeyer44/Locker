FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV PYTHON=/usr/bin/python3

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --ignore-scripts=false || pnpm install --ignore-scripts=false
RUN pnpm rebuild better-sqlite3 \
  && node -e "require('better-sqlite3'); console.log('better-sqlite3 native binding loaded')"

COPY . .

ENV QMD_DATA_DIR=/data/qmd
ENV QMD_PORT=9600

EXPOSE 9600

VOLUME ["/data/qmd"]

CMD ["node", "--import", "tsx", "src/index.ts"]
