# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .


# --- Production stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE ${PORT:-3000}
CMD ["npm", "start"]
