FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/telnyx-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && mkdir -p /data/files && chown -R node:node /data
COPY server/telnyx.mjs server/telnyx-utils.mjs ./
USER node
EXPOSE 8088
CMD ["node","telnyx.mjs"]
