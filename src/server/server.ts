import { createApp } from "./app";

const uploadDirectory = "docker/data/uploads";
const port = process.env.PORT ?? 3333;
const dbName = process.env.DATABASE;
if (!dbName) {
    console.error("Environment variable DATABASE missing");
    process.exit(-1);
}
const dbUser = process.env.DATABASE_USER;
if (!dbUser) {
    console.error("Environment variable DATABASE_USER missing");
    process.exit(-1);
}
const dbPassword = process.env.DATABASE_PASSWORD;
if (!dbPassword) {
    console.error("Environment variable DATABASE_PASSWORD missing");
    process.exit(-1);
}

createApp({ name: dbName, user: dbUser, password: dbPassword, host: "db", port: 5432 }, uploadDirectory, port);
