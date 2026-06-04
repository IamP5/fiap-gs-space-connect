# Multi-stage build for a SwarmBuild Go binary. Parameterised by TARGET so the
# same Dockerfile builds the coordinator and the gateway.
#   docker build -f deploy/Dockerfile --build-arg TARGET=./cmd/coordinator .
# Build context is the repo root (so go.mod and all packages are visible).
FROM golang:1.25 AS build
WORKDIR /src

# Cache module downloads.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG TARGET=./cmd/coordinator
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/app "${TARGET}"

# Minimal runtime image.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
ENTRYPOINT ["/app"]
