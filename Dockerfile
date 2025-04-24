# 1. Use a slim Node.js base image
FROM node:20-slim

# 2. Install system dependencies needed for Chromium to run
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libappindicator3-1 \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdbus-1-3 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libnspr4 libnss3 libxshmfence1 \
    xdg-utils wget gnupg unzip \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# 3. Set working directory
WORKDIR /app

# Create the output directory
RUN mkdir -p /app/output

# 4. Copy and install dependencies (Puppeteer will download Chromium)
COPY package.json package-lock.json ./
RUN npm ci

# 5. Copy the rest of the application
COPY . .

# 6. Expose port (adjust if your app uses a different one)
EXPOSE 10000

# 7. Start the app
CMD ["npm", "start"]
