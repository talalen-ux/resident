# The keeper, for Railway or anything else that runs a container.
#
# Not the website: that is a separate deploy and does not need a key. This image
# runs one process, the keeper loop, and its only writable state is the journal.
FROM node:22-slim

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# The journal is the record of what the desk owns. It MUST be on a volume:
# without one, every redeploy loses the file and the keeper restarts believing
# it holds nothing, which is how a position gets opened twice.
ENV RESIDENT_JOURNAL=/data/keeper.ndjson
VOLUME ["/data"]

CMD ["npm", "run", "keeper", "--", "--journal=/data/keeper.ndjson"]
