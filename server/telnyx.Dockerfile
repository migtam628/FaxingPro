FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/telnyx-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && mkdir -p /data/files && chown -R node:node /data
# Some VPS checkouts have root-owned source files with restrictive permissions.
# Force readable ownership/mode in the image, independent of build-context permissions.
COPY --chown=node:node --chmod=0644 server/telnyx.mjs server/telnyx-utils.mjs server/operator-totp.mjs server/operator-auth-policy.mjs server/team-auth.mjs ./
USER node
# Run as the actual service account so broken permissions fail at build time.
RUN node --check /app/telnyx.mjs && node --check /app/telnyx-utils.mjs && node --check /app/operator-totp.mjs && node --check /app/operator-auth-policy.mjs && node --check /app/team-auth.mjs
EXPOSE 8088
CMD ["node","telnyx.mjs"]
