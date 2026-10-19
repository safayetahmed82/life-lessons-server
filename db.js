import dns from "node:dns";
import { MongoClient } from "mongodb";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

export const client = new MongoClient(process.env.MONGODB_URI);
export const db = client.db();