FROM node:lts

# Setup
ARG ENVIRONMENT=production
ENV NODE_ENV=$ENVIRONMENT

WORKDIR /app/server
COPY ./ ./

# Build
RUN npm install || exit 1

# Run
CMD npm start
