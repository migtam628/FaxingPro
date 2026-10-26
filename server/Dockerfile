FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/index.mjs ./index.mjs
USER node
EXPOSE 8088
CMD ["node","index.mjs"]
