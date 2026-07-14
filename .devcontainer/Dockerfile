FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl lsof procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspaces/ai_shell
