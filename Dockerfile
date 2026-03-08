FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY scripts ./scripts
COPY tests ./tests
COPY src ./src
COPY db ./db
COPY docs ./docs
COPY PRD.md ./PRD.md
COPY README.md ./README.md

RUN chmod +x scripts/*.sh tests/*.sh || true

CMD ["npm", "run", "check"]
