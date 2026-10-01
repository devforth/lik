# ---------- Stage 1: Web build + Capacitor sync ----------
FROM node:24-slim AS web
WORKDIR /workspace

# (git is sometimes needed for dependencies)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install dependencies and build web (pnpm version comes from package.json "packageManager")
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
# Sync Android project (non-interactively via CI=1)
RUN CI=1 pnpm exec cap sync android

# ---------- Stage 2: Android build ----------
FROM mobiledevops/android-sdk-image:latest AS android
WORKDIR /workspace

# Provide JDK 21 so it doesn't complain about "source 21"
RUN apt-get update && apt-get install -y openjdk-21-jdk && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH="$JAVA_HOME/bin:${PATH}"

# AGP 8.13 builds with Build-Tools 35.0.0, which the image lacks; install it in a cached layer
# (otherwise Gradle downloads it on every build)
RUN yes | sdkmanager --sdk_root="$ANDROID_HOME" "build-tools;35.0.0" >/dev/null

# Copy android/ and node_modules from previous stage
COPY --from=web /workspace/android ./android
COPY --from=web /workspace/node_modules ./node_modules
COPY --from=web /workspace/package.json ./package.json

# Build release bundle (non-debuggable by default).
# Gradle's home is a BuildKit cache kept between builds, so the wrapper, dependencies and
# build cache are downloaded and compiled once instead of on every build
WORKDIR /workspace/android
ENV GRADLE_USER_HOME=/gradle
RUN --mount=type=cache,target=/gradle ./gradlew --no-daemon bundleRelease

# ---------- Stage 3: just the bundle, exported to the host by build.sh ----------
FROM scratch AS aab
COPY --from=android /workspace/android/app/build/outputs/bundle/release/ /
