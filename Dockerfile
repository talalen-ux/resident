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
ENV RESIDENT_JOURNAL=/data/keeper.ndjson
VOLUME ["/data"]

CMD ["npm", "run", "keeper", "--", "--journal=/data/keeper.ndjson"]
