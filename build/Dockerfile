# ---------- Stage 1: Web build + Capacitor sync ----------
FROM node:20-slim AS web
WORKDIR /workspace

# (git is sometimes needed for dependencies)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install dependencies and build web
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Sync Android project (non-interactively via CI=1)
RUN CI=1 npx cap sync android

# ---------- Stage 2: Android build ----------
FROM mobiledevops/android-sdk-image:latest
WORKDIR /workspace

# Provide JDK 21 so it doesn't complain about "source 21"
RUN apt-get update && apt-get install -y openjdk-21-jdk && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH="$JAVA_HOME/bin:${PATH}"

# Copy android/ and node_modules from previous stage
COPY --from=web /workspace/android ./android
COPY --from=web /workspace/node_modules ./node_modules

# Required SDK components (adjust versions if different in your project)
RUN yes | sdkmanager "platforms;android-35" "platform-tools" "build-tools;35.0.0" "cmdline-tools;latest" || true

# Build
WORKDIR /workspace/android
RUN chmod +x gradlew
# Build release bundle (non-debuggable by default)
RUN ./gradlew --no-daemon bundleRelease
