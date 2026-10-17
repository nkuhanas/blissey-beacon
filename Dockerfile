FROM node:24.22.0-bookworm-slim
RUN npm install --global pnpm@10.34.7
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
# Development/CI toolchain. Bind-mount the repo; dependencies live in a Docker volume.
CMD ["pnpm", "check"]
