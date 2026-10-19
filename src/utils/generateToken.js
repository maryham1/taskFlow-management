import jwt from "jsonwebtoken";

export const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      id: userId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES || "7d",
    },
  );
};
