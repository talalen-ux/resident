# The keeper, for Railway or anything else that runs a container.
#
# Not the website: that is a separate deploy and does not need a key. This image
# runs one process, the keeper loop, and its only writable state is the journal.
#
# What reaches the image is decided by .dockerignore, which keeps the website,
# the test rig and the repository history out. src/lib is self-contained, so
# the keeper still has everything it imports.
FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production

# Dependencies first, so a code change does not reinstall them.
#
# npm ci refuses to install when package.json and package-lock.json disagree
# about which section a package belongs to. That is the correct behaviour and
# the fix is always to regenerate the lockfile — npm install --package-lock-only
# — never to relax the install.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Load every module the keeper loads, before anything is deployed.
#
# Without this step a dependency that is present for the tests and absent here
# builds clean, deploys, and fails on the first tick. The build is the last
# place that failure is cheap.
RUN node --experimental-strip-types scripts/selftest.mjs

# The journal is the record of what the desk owns. It MUST be on a volume:
# without one, every redeploy loses the file and the keeper restarts believing
# it holds nothing, which is how a position gets opened twice.
#
# There is no VOLUME directive here. Railway rejects a Dockerfile containing one
# ("docker VOLUME is not supported, use Railway Volumes"), and a VOLUME
# directive only ever declared an anonymous volume a platform was free to
# ignore: it stated the requirement and enforced nothing. The variable below
# makes the keeper check the filesystem at startup and refuse to run if /data is
# part of the image rather than a mount.
#
# On Railway: Service, Settings, Volumes, Add Volume, mount path /data.
ENV RESIDENT_JOURNAL=/data/keeper.ndjson
ENV RESIDENT_REQUIRE_VOLUME=1

# Verify the chain constants, then run the keeper. Every address in
# src/lib/chain.ts was transcribed from Robinhood's docs, and this is the first
# place with network access to check them against the chain itself.
#
# It fails closed: a failed verification stops the keeper starting rather than
# letting it act on addresses that could not be confirmed. Railway's ON_FAILURE
# policy retries, so a transient RPC blip recovers on its own; a wrong address
# keeps failing, which is the point.
CMD ["npm", "run", "boot"]
