FROM node:18-slim

# Install required dependencies for Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
    --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Optional: Install Chromium manually, or let Puppeteer do it
# RUN apt-get install -y chromium

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (use puppeteer-core, not full puppeteer)
RUN npm ci

# Copy source code
COPY . .

# Puppeteer requires this ENV in Docker
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expose app port
EXPOSE 3000

CMD ["npm", "start"]
