FROM node:19

WORKDIR /app/docker

# Copy the script and make it executable
COPY server.sh .
RUN chmod +x server.sh

CMD ["./server.sh"]