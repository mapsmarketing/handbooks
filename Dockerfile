# Use full Puppeteer image with Chromium already installed
FROM ghcr.io/puppeteer/puppeteer:latest

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app
COPY . .

# Create output dir
RUN mkdir -p /app/output

# Expose port
EXPOSE 10000

# Run app
CMD ["node", "index.js"]
