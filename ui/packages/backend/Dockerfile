# Stage 1 - Create yarn install skeleton layer
FROM node:22-bookworm-slim AS packages

WORKDIR /app
COPY backstage.json package.json yarn.lock ./
COPY .yarn ./.yarn
COPY .yarnrc.yml ./

COPY packages packages

# Comment this out if you don't have any internal plugins
COPY plugins plugins

RUN find packages \! -name "package.json" -mindepth 2 -maxdepth 2 -exec rm -rf {} \+

# Stage 2 - Install dependencies and build packages
FROM node:22-bookworm-slim AS build

# Get the target architecture from Docker buildx
ARG TARGETARCH

# Set Python interpreter for `node-gyp` to use
ENV PYTHON=/usr/bin/python3

# Install isolate-vm dependencies, these are needed by the @backstage/plugin-scaffolder-backend.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install sqlite3 dependencies. You can skip this if you don't use sqlite3 in the image,
# in which case you should also move better-sqlite3 to "devDependencies" in package.json.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

COPY --from=packages --chown=node:node /app .

# Configure Yarn to fetch the correct architecture binaries for native modules
# This ensures @swc/core and other native modules use prebuilt binaries instead of compiling
# TARGETARCH is set by Docker buildx (amd64, arm64, etc.)
RUN YARN_ARCH=$(echo ${TARGETARCH} | sed 's/amd64/x64/g' | sed 's/arm64/arm64/g') && \
    echo "supportedArchitectures:" >> .yarnrc.yml && \
    echo "  os:" >> .yarnrc.yml && \
    echo "    - linux" >> .yarnrc.yml && \
    echo "  cpu:" >> .yarnrc.yml && \
    echo "    - ${YARN_ARCH}" >> .yarnrc.yml && \
    echo "" >> .yarnrc.yml && \
    echo "enableScripts: false" >> .yarnrc.yml

# Install dependencies without running build scripts first (to use prebuilt binaries)
# Then selectively run scripts for packages that need them
RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn install --immutable && \
    yarn rebuild better-sqlite3 isolated-vm

COPY --chown=node:node . .

RUN yarn --cwd packages/backend build

RUN mkdir packages/backend/dist/skeleton packages/backend/dist/bundle \
    && tar xzf packages/backend/dist/skeleton.tar.gz -C packages/backend/dist/skeleton \
    && tar xzf packages/backend/dist/bundle.tar.gz -C packages/backend/dist/bundle

# Stage 3 - Build the actual backend image and install production dependencies
FROM node:22-bookworm-slim

# Get the target architecture from Docker buildx
ARG TARGETARCH

# Set Python interpreter for `node-gyp` to use
ENV PYTHON=/usr/bin/python3

# Install isolate-vm dependencies, these are needed by the @backstage/plugin-scaffolder-backend.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install sqlite3 dependencies. You can skip this if you don't use sqlite3 in the image,
# in which case you should also move better-sqlite3 to "devDependencies" in package.json.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

# From here on we use the least-privileged `node` user to run the backend.
USER node

# This should create the app dir as `node`.
# If it is instead created as `root` then the `tar` command below will
# fail: `can't create directory 'packages/': Permission denied`.
# If this occurs, then ensure BuildKit is enabled (`DOCKER_BUILDKIT=1`)
# so the app dir is correctly created as `node`.
WORKDIR /app

# Copy the install dependencies from the build stage and context
COPY --from=build --chown=node:node /app/.yarn ./.yarn
COPY --from=build --chown=node:node /app/.yarnrc.yml  ./
COPY --from=build --chown=node:node /app/backstage.json ./
COPY --from=build --chown=node:node /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton/ ./

# Note: The skeleton bundle only includes package.json files -- if your app has
# plugins that define a `bin` export, the bin files need to be copied as well to
# be linked in node_modules/.bin during yarn install.

# Configure Yarn architecture again for production dependencies
RUN YARN_ARCH=$(echo ${TARGETARCH} | sed 's/amd64/x64/g' | sed 's/arm64/arm64/g') && \
    echo "supportedArchitectures:" >> .yarnrc.yml && \
    echo "  os:" >> .yarnrc.yml && \
    echo "    - linux" >> .yarnrc.yml && \
    echo "  cpu:" >> .yarnrc.yml && \
    echo "    - ${YARN_ARCH}" >> .yarnrc.yml && \
    echo "" >> .yarnrc.yml && \
    echo "enableScripts: false" >> .yarnrc.yml

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && \
    yarn rebuild better-sqlite3 isolated-vm && \
    rm -rf "$(yarn cache clean)"

# Copy the built packages from the build stage
COPY --from=build --chown=node:node /app/packages/backend/dist/bundle/ ./

# Copy any other files that we need at runtime
COPY --chown=node:node app-config.production.yaml ./app-config.yaml
COPY --chown=node:node templates/ /app/templates

# This will include the examples, if you don't need these simply remove this line
COPY --chown=node:node examples ./examples

# This switches many Node.js dependencies to production mode.
ENV NODE_ENV=production

# This disables node snapshot for Node 20 to work with the Scaffolder
ENV NODE_OPTIONS="--no-node-snapshot"

CMD ["node", "packages/backend"]
