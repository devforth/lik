# ---------- Stage 1: Web build + Capacitor sync ----------
FROM node:20-slim AS web
WORKDIR /workspace

# (git інколи треба для залежностей)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Встановити залежності та зібрати веб
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Синкнути Android-проєкт (неінтерактивно через CI=1)
RUN CI=1 npx cap sync android

# ---------- Stage 2: Android build ----------
FROM mobiledevops/android-sdk-image:latest
WORKDIR /workspace

# Доставимо JDK 21, щоб не сварився на "source 21"
RUN apt-get update && apt-get install -y openjdk-21-jdk && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH="$JAVA_HOME/bin:${PATH}"

# Копіюємо android/ і node_modules з попереднього стейджу
COPY --from=web /workspace/android ./android
COPY --from=web /workspace/node_modules ./node_modules

# Потрібні SDK-компоненти (підлаштуй версії якщо інші у твоєму проєкті)
RUN yes | sdkmanager "platforms;android-35" "platform-tools" "build-tools;35.0.0" "cmdline-tools;latest" || true

# Збірка
WORKDIR /workspace/android
RUN chmod +x gradlew
RUN ./gradlew --no-daemon assembleDebug
