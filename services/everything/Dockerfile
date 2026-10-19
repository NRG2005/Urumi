# The official MCP reference server ("everything"), served over Streamable HTTP.
# Used as the in-cluster upstream for the kill-the-pod demo.
FROM node:22-alpine
# tini as PID 1: forwards SIGTERM so the server exits immediately when the pod is killed
# (node as PID 1 ignores SIGTERM and would keep serving for the whole grace period).
RUN apk add --no-cache tini && npm install -g @modelcontextprotocol/server-everything@2.0.0 && npm cache clean --force
USER node
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["mcp-server-everything", "streamableHttp"]
