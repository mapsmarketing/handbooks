# 1) Start from Puppeteer’s official image (Node & Chrome bundled)
FROM ghcr.io/puppeteer/puppeteer:latest

# 2) Create & set working dir
WORKDIR /app

# 3) Copy package files
COPY package.json package-lock.json ./

# 4) Prevent Puppeteer from downloading Chromium (we already have it)
# ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# ENV NODE_OPTIONS="--max-old-space-size=2048"

# 5) Install deps
RUN npm ci

# 6) Copy your app
COPY . .

# 7) Expose the port your Express app listens on
EXPOSE 10000

# 8) Run your app
CMD ["npm", "start"]