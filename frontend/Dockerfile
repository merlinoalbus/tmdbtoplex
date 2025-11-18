FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ARG VITE_TMDB_BEARER_TOKEN
ARG VITE_GOOGLE_API_KEY
ARG VITE_OMDB_API_KEY
ARG VITE_IMDB_SCRAPER_BASE_URL

ENV VITE_TMDB_BEARER_TOKEN=${VITE_TMDB_BEARER_TOKEN}
ENV VITE_GOOGLE_API_KEY=${VITE_GOOGLE_API_KEY}
ENV VITE_OMDB_API_KEY=${VITE_OMDB_API_KEY}
ENV VITE_IMDB_SCRAPER_BASE_URL=${VITE_IMDB_SCRAPER_BASE_URL}

RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
