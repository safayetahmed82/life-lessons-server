import express from "express";
import { db } from "../db.js";
import { verifyUser } from "../middleware/verifyUser.js";

const router = express.Router();
const lessons = db.collection("lessons");

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
      return res.status(400).json({ message: "Please fill in all required fields" });
    }

    const isPremiumUser = req.user.isPremium === true;

    const lesson = {
      title,
      description,
      category,
      emotionalTone,
      image: image || "",
      visibility: visibility === "Private" ? "Private" : "Public",
      accessLevel: isPremiumUser && accessLevel === "Premium" ? "Premium" : "Free",
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

export default router;