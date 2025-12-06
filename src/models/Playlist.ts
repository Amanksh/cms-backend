import mongoose, { Schema, Document } from "mongoose";

/**
 * Playlist Model
 * 
 * Playlists support the "Campaign + Direct Assets" flow:
 * - campaignIds: Array of campaign references (up to 7 campaigns)
 * - assetIds: Array of direct/standalone asset references
 * 
 * When a player fetches a playlist, all campaigns are expanded to show 
 * their contained assets, and direct assets are included separately.
 * 
 * Legacy support: The `items` field is kept for backward compatibility
 * with old asset-based playlists.
 */

export interface IPlaylist extends Document {
  name: string;
  description?: string;
  userId: string;
  status: "active" | "inactive" | "scheduled";
  // Campaign-based structure (up to 7 campaigns)
  campaignIds: mongoose.Types.ObjectId[];
  // Direct assets (standalone assets not in campaigns)
  assetIds: mongoose.Types.ObjectId[];
  // Legacy support for old asset-based structure (deprecated)
  items?: {
    assetId: mongoose.Types.ObjectId;
    duration: number;
    order: number;
  }[];
  schedule?: {
    startDate: Date;
    endDate: Date;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const PlaylistSchema = new Schema<IPlaylist>(
  {
    name: {
      type: String,
      required: [true, "Playlist name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    userId: {
      type: String,
      required: [true, "User ID is required"],
    },
    status: {
      type: String,
      enum: {
        values: ["active", "inactive", "scheduled"],
        message: "Status must be active, inactive, or scheduled",
      },
      default: "inactive",
    },
    // Campaign-based structure (up to 7 campaigns)
    campaignIds: [{
      type: Schema.Types.ObjectId,
      ref: "Campaign",
    }],
    // Direct assets (standalone assets not in campaigns)
    assetIds: [{
      type: Schema.Types.ObjectId,
      ref: "Asset",
    }],
    // Legacy support for old asset-based structure (deprecated)
    items: [
      {
        assetId: {
          type: Schema.Types.ObjectId,
          ref: "Asset",
          validate: {
            validator: function(v: any) {
              return mongoose.Types.ObjectId.isValid(v);
            },
            message: (props: any) => `${props.value} is not a valid ObjectId!`,
          },
        },
        duration: { type: Number },
        order: { type: Number },
      },
    ],
    schedule: {
      startDate: Date,
      endDate: Date,
      daysOfWeek: {
        type: [Number],
        validate: {
          validator: function(v: number[]) {
            return v.every(day => day >= 0 && day <= 6);
          },
          message: "Days of week must be between 0 (Sunday) and 6 (Saturday)",
        },
      },
      startTime: String,
      endTime: String,
    },
  },
  {
    timestamps: true,
  }
);

// Validation: max 7 campaigns per playlist (matches frontend)
PlaylistSchema.pre("save", function(next) {
  if (this.campaignIds && this.campaignIds.length > 7) {
    const error = new Error("Maximum 7 campaigns allowed per playlist");
    return next(error);
  }
  next();
});

// Indexes for faster lookups
PlaylistSchema.index({ userId: 1 });
PlaylistSchema.index({ status: 1 });
PlaylistSchema.index({ campaignIds: 1 });
PlaylistSchema.index({ assetIds: 1 });

export default mongoose.models.Playlist ||
  mongoose.model<IPlaylist>("Playlist", PlaylistSchema);
