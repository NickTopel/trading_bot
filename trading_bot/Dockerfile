FROM node:lts

# Setup
ARG ENVIRONMENT=production
ENV NODE_ENV=$ENVIRONMENT

# Build
WORKDIR /app/trading_bot
COPY ./ ./
RUN (npm install) || exit 1

# Run
CMD npm run start
