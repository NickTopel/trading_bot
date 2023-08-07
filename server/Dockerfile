FROM node:lts

# Setup
ARG ENVIRONMENT=production
ENV NODE_ENV=$ENVIRONMENT

RUN echo $NODE_ENV

WORKDIR /app/server
COPY ./ ./

# Build
RUN npm install || exit 1

# Run
CMD npm start
