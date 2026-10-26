import express from "express";
import { db } from "../db.js";
import { verifyUser } from "../middleware/verifyUser.js";
import { ObjectId } from "mongodb";

const router = express.Router();
const lessons = db.collection("lessons");
const favorites = db.collection("favorites");
const comments = db.collection("comments");
const reports = db.collection("lessonsReports");
const canManage = (lesson, user) =>
  lesson.creatorId === user.id || user.role === "admin";
const canView = (lesson, user) => {
  if (canManage(lesson, user)) return true;
  if (lesson.visibility !== "Public") return false;
  return lesson.accessLevel !== "Premium" || user.isPremium === true;
};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.post("/", verifyUser, async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      emotionalTone,
      image,
      visibility,
      accessLevel,
    } = req.body;

    if (!title || !description || !category || !emotionalTone) {
      return res
        .status(400)
        .json({ message: "Please fill in all required fields" });
    }

    const isPremiumUser = req.user.isPremium === true;

    const lesson = {
      title,
      description,
      category,
      emotionalTone,
      image: image || "",
      visibility: visibility === "Private" ? "Private" : "Public",
      accessLevel:
        isPremiumUser && accessLevel === "Premium" ? "Premium" : "Free",
      creatorId: req.user.id,
      creatorName: req.user.name,
      creatorPhoto: req.user.image,
      likes: [],
      likesCount: 0,
      favoritesCount: 0,
      isFeatured: false,
      isReviewed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await lessons.insertOne(lesson);
    res.status(201).json({ ...lesson, _id: result.insertedId });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});
router.get("/", async (req, res) => {
  try {
    const { search, category, tone, sort } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 6, 24);

    const filter = { visibility: "Public" };

    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: "i" };
      filter.$or = [{ title: pattern }, { description: pattern }];
    }
    if (category) filter.category = category;
    if (tone) filter.emotionalTone = tone;

    let sortOption = { createdAt: -1 };
    if (sort === "mostSaved") {
      sortOption = { favoritesCount: -1, createdAt: -1 };
    }

    const total = await lessons.countDocuments(filter);
    const found = await lessons
      .find(filter)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    const preview = found.map((lesson) => ({
      ...lesson,
      description: lesson.description.slice(0, 120),
    }));

    res.json({
      lessons: preview,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/mine", verifyUser, async (req, res) => {
  try {
    const myLessons = await lessons
      .find({ creatorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(myLessons);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});
router.get("/:id", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    if (!canView(lesson, req.user)) {
      if (lesson.visibility === "Private") {
        return res.status(403).json({ message: "This lesson is private" });
      }
      return res.status(403).json({
        locked: true,
        message: "This is a Premium lesson",
        title: lesson.title,
        category: lesson.category,
        emotionalTone: lesson.emotionalTone,
      });
    }

    const authorLessonCount = await lessons.countDocuments({
      creatorId: lesson.creatorId,
    });
    const favorite = await favorites.findOne({
      userId: req.user.id,
      lessonId: req.params.id,
    });

    const { likes, ...rest } = lesson;

    res.json({
      ...rest,
      liked: likes.includes(req.user.id),
      favorited: Boolean(favorite),
      authorLessonCount,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    if (!canManage(lesson, req.user)) {
      return res
        .status(403)
        .json({ message: "You can only edit your own lessons" });
    }

    const {
      title,
      description,
      category,
      emotionalTone,
      image,
      visibility,
      accessLevel,
    } = req.body;

    const updates = { updatedAt: new Date() };
    if (title) updates.title = title;
    if (description) updates.description = description;
    if (category) updates.category = category;
    if (emotionalTone) updates.emotionalTone = emotionalTone;
    if (image !== undefined) updates.image = image;
    if (visibility === "Public" || visibility === "Private") {
      updates.visibility = visibility;
    }
    if (accessLevel === "Free") updates.accessLevel = "Free";
    if (
      accessLevel === "Premium" &&
      (req.user.isPremium === true || req.user.role === "admin")
    ) {
      updates.accessLevel = "Premium";
    }

    await lessons.updateOne({ _id: lesson._id }, { $set: updates });
    res.json({ ...lesson, ...updates });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:id", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    if (!canManage(lesson, req.user)) {
      return res
        .status(403)
        .json({ message: "You can only delete your own lessons" });
    }

    await lessons.deleteOne({ _id: lesson._id });
    await db.collection("favorites").deleteMany({ lessonId: req.params.id });
    await db.collection("comments").deleteMany({ lessonId: req.params.id });
    await db.collection("lessonsReports").deleteMany({ lessonId: req.params.id });

    res.json({ message: "Lesson deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});
router.post("/:id/like", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson || !canView(lesson, req.user)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const alreadyLiked = lesson.likes.includes(req.user.id);

    if (alreadyLiked) {
      await lessons.updateOne(
        { _id: lesson._id },
        { $pull: { likes: req.user.id }, $inc: { likesCount: -1 } }
      );
    } else {
      await lessons.updateOne(
        { _id: lesson._id },
        { $addToSet: { likes: req.user.id }, $inc: { likesCount: 1 } }
      );
    }

    res.json({
      liked: !alreadyLiked,
      likesCount: lesson.likesCount + (alreadyLiked ? -1 : 1),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/favorite", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson || !canView(lesson, req.user)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const existing = await favorites.findOne({
      userId: req.user.id,
      lessonId: req.params.id,
    });

    if (existing) {
      await favorites.deleteOne({ _id: existing._id });
      await lessons.updateOne({ _id: lesson._id }, { $inc: { favoritesCount: -1 } });
    } else {
      await favorites.insertOne({
        userId: req.user.id,
        lessonId: req.params.id,
        savedAt: new Date(),
      });
      await lessons.updateOne({ _id: lesson._id }, { $inc: { favoritesCount: 1 } });
    }

    res.json({
      favorited: !existing,
      favoritesCount: lesson.favoritesCount + (existing ? -1 : 1),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});
router.get("/:id/comments", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson || !canView(lesson, req.user)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const list = await comments
      .find({ lessonId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(list);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/comments", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson || !canView(lesson, req.user)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const text = (req.body.text || "").trim();
    if (!text) {
      return res.status(400).json({ message: "Please write a comment first" });
    }
    if (text.length > 500) {
      return res.status(400).json({ message: "Comments can be 500 characters at most" });
    }

    const comment = {
      lessonId: req.params.id,
      userId: req.user.id,
      userName: req.user.name,
      userPhoto: req.user.image,
      text,
      createdAt: new Date(),
    };

    const result = await comments.insertOne(comment);
    res.status(201).json({ ...comment, _id: result.insertedId });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

const reportReasons = [
  "Inappropriate Content",
  "Hate Speech or Harassment",
  "Misleading or False Information",
  "Spam or Promotional Content",
  "Sensitive or Disturbing Content",
  "Other",
];

router.post("/:id/report", verifyUser, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const lesson = await lessons.findOne({ _id: new ObjectId(req.params.id) });
    if (!lesson || !canView(lesson, req.user)) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const { reason } = req.body;
    if (!reportReasons.includes(reason)) {
      return res.status(400).json({ message: "Please choose a reason" });
    }

    const already = await reports.findOne({
      lessonId: req.params.id,
      reporterUserId: req.user.id,
    });
    if (already) {
      return res.status(400).json({ message: "You have already reported this lesson" });
    }

    await reports.insertOne({
      lessonId: req.params.id,
      lessonTitle: lesson.title,
      reporterUserId: req.user.id,
      reporterName: req.user.name,
      reporterEmail: req.user.email,
      reason,
      timestamp: new Date(),
    });

    res.status(201).json({ message: "Report submitted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
