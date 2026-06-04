# Build the Vite dashboard and serve the static bundle with nginx.
# Build context is the web/ directory.
#   VITE_WS_URL is baked at build time (Vite env is compile-time): the browser
#   runs on the host, so it points at the gateway's host-published port.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_WS_URL=ws://localhost:8080/ws
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
