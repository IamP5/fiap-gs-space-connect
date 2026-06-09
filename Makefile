# SwarmBuild — build automation.
# Go application code lives under internal/; thin main packages under cmd/.

GO       ?= go
PKGS     ?= ./...
# GNU make ships a built-in default `LINT = lint`, so a plain `?=` is a no-op
# here. Only override when the value is still that built-in default, which keeps
# real env/command-line overrides working.
ifeq ($(origin LINT),default)
LINT     := golangci-lint
endif

.DEFAULT_GOAL := help

.PHONY: help
help: ## List available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.PHONY: build
build: ## Build all packages and binaries
	$(GO) build $(PKGS)

.PHONY: test
test: ## Run the full suite with the race detector
	$(GO) test -race -shuffle=on $(PKGS)

.PHONY: cover
cover: ## Run tests with coverage and print the summary
	$(GO) test -race -coverprofile=coverage.out $(PKGS)
	$(GO) tool cover -func=coverage.out | tail -1

.PHONY: vet
vet: ## Run go vet
	$(GO) vet $(PKGS)

.PHONY: lint
lint: ## Run golangci-lint
	$(LINT) run $(PKGS)

.PHONY: lint-fix
lint-fix: ## Run golangci-lint with --fix
	$(LINT) run --fix $(PKGS)

.PHONY: fmt
fmt: ## Format the codebase (gofmt + gofumpt via golangci-lint)
	$(LINT) fmt $(PKGS)

.PHONY: tidy
tidy: ## Tidy module dependencies
	$(GO) mod tidy

.PHONY: check
check: vet lint test ## Run vet, lint, and the race suite (pre-commit gate)
