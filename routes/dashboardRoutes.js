import express from "express";
import { db } from "../db.js";
import { verifyUser } from "../middleware/verifyUser.js";

const router = express.Router();
const lessons = db.collection("lessons");

router.get("/stats", verifyUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const totalLessons = await lessons.countDocuments({ creatorId: userId });
    const totalFavorites = await db
      .collection("favorites")
      .countDocuments({ userId });

    const mine = await lessons
      .find({ creatorId: userId })
      .project({ likesCount: 1 })
      .toArray();
    const totalLikes = mine.reduce((sum, item) => sum + (item.likesCount || 0), 0);

    const recent = await lessons
      .find({ creatorId: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .project({ title: 1, category: 1, visibility: 1, accessLevel: 1, createdAt: 1 })
      .toArray();

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 6);
    since.setUTCHours(0, 0, 0, 0);

    const lastWeek = await lessons
      .find({ creatorId: userId, createdAt: { $gte: since } })
      .project({ createdAt: 1 })
      .toArray();

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(since);
      day.setUTCDate(since.getUTCDate() + i);
      days.push({
        date: day.toISOString().slice(0, 10),
        label: day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        count: 0,
      });
    }
    lastWeek.forEach((item) => {
      const key = item.createdAt.toISOString().slice(0, 10);
      const match = days.find((day) => day.date === key);
      if (match) match.count += 1;
    });

    res.json({ totalLessons, totalFavorites, totalLikes, recent, week: days });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/sync-profile", verifyUser, async (req, res) => {
  try {
    await lessons.updateMany(
      { creatorId: req.user.id },
      { $set: { creatorName: req.user.name, creatorPhoto: req.user.image } }
    );
    await db
      .collection("comments")
      .updateMany(
        { userId: req.user.id },
        { $set: { userName: req.user.name, userPhoto: req.user.image } }
      );
    res.json({ message: "Profile synced" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;