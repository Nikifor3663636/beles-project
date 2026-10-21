FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN npm ci --omit=dev && apk add --no-cache su-exec ghostscript qpdf util-linux && mkdir -p data uploads && chown -R node:node data uploads
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["node", "server.cjs"]
