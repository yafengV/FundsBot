SHELL := /bin/bash

.PHONY: help deps up down logs db-init db-seed db-reset ci

help:
	@echo "Targets:"
	@echo "  make deps      - install local CLI deps if missing (jq, openapi lint cli)"
	@echo "  make up        - start postgres/redis"
	@echo "  make down      - stop postgres/redis"
	@echo "  make logs      - tail docker logs"
	@echo "  make db-init   - apply db/schema.sql"
	@echo "  make db-seed   - apply db/seed.sql"
	@echo "  make db-reset  - reset db and re-run schema+seed"
	@echo "  make ci        - run local CI checks"

deps:
	@bash scripts/bootstrap.sh

up:
	docker compose -f docker-compose.dev.yml up -d

down:
	docker compose -f docker-compose.dev.yml down

logs:
	docker compose -f docker-compose.dev.yml logs -f --tail=100

db-init:
	psql postgresql://fundsbot:fundsbot@localhost:5432/fundsbot -f db/schema.sql

db-seed:
	psql postgresql://fundsbot:fundsbot@localhost:5432/fundsbot -f db/seed.sql

db-reset:
	psql postgresql://fundsbot:fundsbot@localhost:5432/postgres -c "DROP DATABASE IF EXISTS fundsbot;"
	psql postgresql://fundsbot:fundsbot@localhost:5432/postgres -c "CREATE DATABASE fundsbot;"
	$(MAKE) db-init
	$(MAKE) db-seed

ci:
	bash scripts/ci-check.sh
