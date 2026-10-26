import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { client } from "./db.js";
import { auth } from "./auth.js";
import lessonRoutes from "./routes/lessonRoutes.js";
import paymentRoutes, { stripeWebhook } from "./routes/paymentRoutes.js";

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Better Auth must come BEFORE express.json()
app.all("/api/auth/*splat", toNodeHandler(auth));
app.all("/api/auth/*splat", toNodeHandler(auth));

app.post("/webhook", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json());

app.use("/api/lessons", lessonRoutes);
app.use(paymentRoutes);

app.use(express.json());
app.use("/api/lessons", lessonRoutes);

app.get("/", (req, res) => {
  res.json({ message: "LifeLessons API is running" });
});

await client.connect();
console.log("MongoDB connected");

app.listen(process.env.PORT, () => {
  console.log("Server running on port " + process.env.PORT);
});