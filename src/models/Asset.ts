import mongoose, { Schema, Document } from "mongoose";

export interface IAsset extends Document {
  name: string;
  type: "IMAGE" | "VIDEO" | "HTML" | "URL";
  url: string;
  thumbnail?: string;
  duration?: number;
  size: number;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const AssetSchema = new Schema<IAsset>(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["IMAGE", "VIDEO", "HTML", "URL"],
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    thumbnail: String,
    duration: Number,
    size: {
      type: Number,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.Asset ||
  mongoose.model<IAsset>("Asset", AssetSchema);
