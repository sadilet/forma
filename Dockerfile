# One Dockerfile, two images (see docs/cloud.md):
#   docker build --target web    -t forma-web .       the Forma app (Next.js)
#   docker build --target worker -t forma-worker .    the deploy worker (builds apps and ships them to Cloud Run)
# scripts/cloud-deploy.ts builds both with Cloud Build, so Docker is not needed on your machine.

FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The tldraw license is read while the page is built, so it has to be passed in here (see scripts/cloud-deploy.ts).
ARG NEXT_PUBLIC_TLDRAW_LICENSE_KEY=
ENV NEXT_PUBLIC_TLDRAW_LICENSE_KEY=$NEXT_PUBLIC_TLDRAW_LICENSE_KEY
RUN npm run build

# ---- web: the Next.js standalone server --------------------------------------------------------------------------
FROM node:26-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]

# ---- worker: Node, git, ssh and the gcloud CLI -------------------------------------------------------------------
FROM node:26-slim AS worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar -xz -C /opt \
 && /opt/google-cloud-sdk/install.sh --quiet --usage-reporting=false --path-update=false --command-completion=false \
 && ln -s /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
WORKDIR /app
ENV NODE_ENV=production CLOUDSDK_CORE_DISABLE_PROMPTS=1 HOME=/home/node
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src/lib ./src/lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node deploy-templates ./deploy-templates
# The shared demo key from the project root (docs/deploy.md). ssh only accepts it with mode 600, and the worker sets that.
COPY --chown=node:node example_github_ssh ./example_github_ssh
RUN mkdir -p /app/data/deploy /home/node/.config && chown -R node:node /app/data /home/node
USER node
# Cloud Run only starts containers that listen on $PORT. The worker answers a plain "ok" there and does its real work in the background.
CMD ["node", "--experimental-strip-types", "scripts/deploy-worker.ts"]
