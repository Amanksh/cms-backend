import mongoose, { Schema, Document } from "mongoose";

/**
 * Campaign Model
 * 
 * Campaigns are containers for assets. Users must create a campaign
 * before uploading any assets. Each campaign can contain up to 9 assets.
 * 
 * Note: Campaign names are unique per user (compound index on name + userId)
 */

export interface ICampaign extends Document {
  name: string;
  description?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    name: {
      type: String,
      required: [true, "Campaign name is required"],
      trim: true,
      maxlength: [100, "Campaign name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    userId: {
      type: String,
      required: [true, "User ID is required"],
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index for name per user (matches frontend)
CampaignSchema.index({ name: 1, userId: 1 }, { unique: true });
CampaignSchema.index({ createdAt: -1 });

export default mongoose.models.Campaign ||
  mongoose.model<ICampaign>("Campaign", CampaignSchema);
