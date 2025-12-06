import mongoose, { Schema, Document } from "mongoose";

/**
 * Asset Model
 * 
 * Assets represent media content (images, videos, HTML, URLs).
 * Assets can either:
 * - Belong to a campaign (campaignId is set) - max 9 assets per campaign
 * - Be standalone/direct assets (campaignId is null) - no campaign folder
 * 
 * This matches the frontend model for the "Campaign + Direct Assets" flow.
 */

export interface IAsset extends Document {
  name: string;
  type: "IMAGE" | "VIDEO" | "HTML" | "URL";
  url: string;
  thumbnail?: string;
  duration?: number;
  size?: number;
  userId: mongoose.Types.ObjectId;
  // campaignId is OPTIONAL - null means it's a direct/standalone asset
  campaignId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const AssetSchema = new Schema<IAsset>(
  {
    name: {
      type: String,
      required: [true, "Asset name is required"],
      trim: true,
    },
    type: {
      type: String,
      enum: {
        values: ["IMAGE", "VIDEO", "HTML", "URL"],
        message: "Type must be IMAGE, VIDEO, HTML, or URL",
      },
      required: [true, "Asset type is required"],
    },
    url: {
      type: String,
      required: [true, "Asset URL is required"],
    },
    thumbnail: {
      type: String,
    },
    duration: {
      type: Number,
    },
    size: {
      type: Number,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    // campaignId is OPTIONAL - null means it's a direct/standalone asset
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries (matches frontend)
AssetSchema.index({ campaignId: 1 });
AssetSchema.index({ userId: 1 });
AssetSchema.index({ userId: 1, campaignId: 1 }); // For finding direct assets
AssetSchema.index({ campaignId: 1, createdAt: -1 });

export default mongoose.models.Asset ||
  mongoose.model<IAsset>("Asset", AssetSchema);
