import express from "express";
import { db } from "../db.js";
import { verifyUser } from "../middleware/verifyUser.js";
import { ObjectId } from "mongodb";

const router = express.Router();
const lessons = db.collection("lessons");
const canManage = (lesson, user) =>
  lesson.creatorId === user.id || user.role === "admin";

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

    if (lesson.visibility === "Private" && !canManage(lesson, req.user)) {
      return res.status(403).json({ message: "This lesson is private" });
    }

    res.json(lesson);
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

    res.json({ message: "Lesson deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
