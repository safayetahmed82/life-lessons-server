import { verifyUser } from "./verifyUser.js";

const checkAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admins only" });
  }
  next();
};

export const verifyAdmin = [verifyUser, checkAdmin];