FROM node:lts

# Setup
ARG ENVIRONMENT=production
ENV NODE_ENV=$ENVIRONMENT

WORKDIR /app/trading_bot
COPY ./ ./

# Build
RUN ([ "$ENVIRONMENT" == "development" ] && npm install ../lib --save) || (npm install @alphainsider/trading_bot --save) || exit 1

# Run
CMD npm start
