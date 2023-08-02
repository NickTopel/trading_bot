# !! UNDER ACTIVE DEVELOPEMENT, NOT READY FOR USE!!

# trading_bot
Trading bot that follows AlphaInsider strategies

## Run
`$ docker compose up`

## Test
`$ docker compose run trading_bot bash`  
`$ node test.js`

# Build Production Services
$ docker-compose -f docker-compose-prod.yml build --no-cache
# Publish image to dockerhub (tag optional)
$ docker push alphainsider/<service>:<tag?>
