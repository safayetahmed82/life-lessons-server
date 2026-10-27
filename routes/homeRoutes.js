import express from "express";
import { db } from "../db.js";

const router = express.Router();
const lessons = db.collection("lessons");

const preview = ({ likes, ...rest }) => ({
  ...rest,
  description: rest.description.slice(0, 120),
});

router.get("/featured", async (req, res) => {
  try {
    const found = await lessons
      .find({ visibility: "Public", isFeatured: true })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    res.json(found.map(preview));
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/top-contributors", async (req, res) => {
  try {
    const buildPipeline = (since) => [
      {
        $match: since
          ? { visibility: "Public", createdAt: { $gte: since } }
          : { visibility: "Public" },
      },
      {
        $group: {
          _id: "$creatorId",
          name: { $first: "$creatorName" },
          photo: { $first: "$creatorPhoto" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ];

    const weekAgo = new Date();
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

    let contributors = await lessons.aggregate(buildPipeline(weekAgo)).toArray();
    let period = "week";

    if (contributors.length === 0) {
      contributors = await lessons.aggregate(buildPipeline(null)).toArray();
      period = "all-time";
    }

    res.json({ period, contributors });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/most-saved", async (req, res) => {
  try {
    const found = await lessons
      .find({ visibility: "Public" })
      .sort({ favoritesCount: -1, createdAt: -1 })
      .limit(6)
      .toArray();
    res.json(found.map(preview));
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;