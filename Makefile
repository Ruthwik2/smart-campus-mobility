.PHONY: up down logs migrate seed dev-api dev-web

up:            ## Build & start the full stack
	docker compose up -d --build

down:          ## Stop everything
	docker compose down

logs:
	docker compose logs -f api web

migrate:       ## Apply migrations inside the api container
	docker compose exec api npx prisma migrate deploy

seed:          ## Seed demo data
	docker compose exec api npx prisma db seed

dev-api:       ## Run API locally (needs postgres+redis from compose)
	cd server && npm run dev

dev-web:
	cd web && npm run dev
