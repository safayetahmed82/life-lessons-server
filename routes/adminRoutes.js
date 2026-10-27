import express from "express";
import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";

const router = express.Router();
const users = db.collection("user");
const lessons = db.collection("lessons");
const reports = db.collection("lessonsReports");

const lastSevenDays = async (collection) => {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 6);
  since.setUTCHours(0, 0, 0, 0);

  const docs = await collection
    .find({ createdAt: { $gte: since } })
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

  docs.forEach((doc) => {
    const key = doc.createdAt.toISOString().slice(0, 10);
    const match = days.find((day) => day.date === key);
    if (match) match.count += 1;
  });

  return days;
};

router.get("/stats", verifyAdmin, async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
    weekAgo.setUTCHours(0, 0, 0, 0);

    const [
      totalUsers,
      publicLessons,
      reportedIds,
      todayLessons,
      contributors,
      lessonGrowth,
      userGrowth,
    ] = await Promise.all([
      users.countDocuments(),
      lessons.countDocuments({ visibility: "Public" }),
      reports.distinct("lessonId"),
      lessons.countDocuments({ createdAt: { $gte: startOfToday } }),
      lessons
        .aggregate([
          { $match: { createdAt: { $gte: weekAgo } } },
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
        ])
        .toArray(),
      lastSevenDays(lessons),
      lastSevenDays(users),
    ]);

    res.json({
      totalUsers,
      publicLessons,
      reportedLessons: reportedIds.length,
      todayLessons,
      contributors,
      lessonGrowth,
      userGrowth,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/users", verifyAdmin, async (req, res) => {
  try {
    const list = await users
      .find()
      .project({ name: 1, email: 1, image: 1, role: 1, isPremium: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .toArray();

    const counts = await lessons
      .aggregate([{ $group: { _id: "$creatorId", total: { $sum: 1 } } }])
      .toArray();

    const countMap = {};
    counts.forEach((item) => {
      countMap[item._id] = item.total;
    });

    res.json(
      list.map((user) => ({
        ...user,
        role: user.role || "user",
        isPremium: user.isPremium === true,
        totalLessons: countMap[String(user._id)] || 0,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/users/:id/role", verifyAdmin, async (req, res) => {
  try {
    const { role } = req.body;

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: "You cannot change your own role" });
    }

    const result = await users.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Role updated" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/lessons", verifyAdmin, async (req, res) => {
  try {
    const { category, visibility, flagged } = req.query;

    const reportCounts = await reports
      .aggregate([{ $group: { _id: "$lessonId", count: { $sum: 1 } } }])
      .toArray();
    const reportMap = {};
    reportCounts.forEach((item) => {
      reportMap[item._id] = item.count;
    });

    const filter = {};
    if (category) filter.category = category;
    if (visibility === "Public" || visibility === "Private") {
      filter.visibility = visibility;
    }
    if (flagged === "true") {
      filter._id = {
        $in: Object.keys(reportMap)
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id)),
      };
    }

    const found = await lessons
      .find(filter)
      .sort({ createdAt: -1 })
      .project({ likes: 0, description: 0 })
      .toArray();

    const [publicCount, privateCount] = await Promise.all([
      lessons.countDocuments({ visibility: "Public" }),
      lessons.countDocuments({ visibility: "Private" }),
    ]);

    res.json({
      lessons: found.map((lesson) => ({
        ...lesson,
        reportCount: reportMap[String(lesson._id)] || 0,
      })),
      counts: {
        public: publicCount,
        private: privateCount,
        flagged: Object.keys(reportMap).length,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/lessons/:id/featured", verifyAdmin, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }
    await lessons.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isFeatured: req.body.isFeatured === true } }
    );
    res.json({ message: "Lesson updated" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/lessons/:id/reviewed", verifyAdmin, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }
    await lessons.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isReviewed: true } }
    );
    res.json({ message: "Marked as reviewed" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/reports", verifyAdmin, async (req, res) => {
  try {
    const grouped = await reports
      .aggregate([
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$lessonId",
            lessonTitle: { $first: "$lessonTitle" },
            count: { $sum: 1 },
            reports: {
              $push: {
                reporterName: "$reporterName",
                reporterEmail: "$reporterEmail",
                reason: "$reason",
                timestamp: "$timestamp",
              },
            },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();

    res.json(grouped);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/reports/:lessonId", verifyAdmin, async (req, res) => {
  try {
    await reports.deleteMany({ lessonId: req.params.lessonId });

    if (ObjectId.isValid(req.params.lessonId)) {
      await lessons.updateOne(
        { _id: new ObjectId(req.params.lessonId) },
        { $set: { isReviewed: true } }
      );
    }

    res.json({ message: "Reports cleared" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;