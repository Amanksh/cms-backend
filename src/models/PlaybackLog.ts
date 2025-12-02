import mongoose, { Schema, Document } from "mongoose";

/**
 * PlaybackLog Model
 * 
 * This model stores proof-of-play data from digital signage players.
 * Uses snake_case field names to match existing data in MongoDB.
 * 
 * The API accepts BOTH camelCase and snake_case inputs for flexibility.
 */

// TypeScript interface for PlaybackLog document
export interface IPlaybackLog extends Document {
  device_id: string;
  asset_id: string;
  playlist_id?: string;
  start_time: Date;
  end_time: Date;
  duration: number;
  created_at: Date;
}

// Mongoose schema definition
const PlaybackLogSchema = new Schema<IPlaybackLog>(
  {
    device_id: {
      type: String,
      required: [true, "device_id is required"],
      trim: true,
    },
    asset_id: {
      type: String,
      required: [true, "asset_id is required"],
      trim: true,
    },
    playlist_id: {
      type: String,
      trim: true,
      default: null,
    },
    start_time: {
      type: Date,
      required: [true, "start_time is required"],
    },
    end_time: {
      type: Date,
      required: [true, "end_time is required"],
    },
    duration: {
      type: Number,
      required: [true, "duration is required"],
      min: [0, "duration must be a positive number"],
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    collection: "playback_logs",
  }
);

/**
 * Indexes for optimized query performance
 */
PlaybackLogSchema.index({ device_id: 1, start_time: -1 });
PlaybackLogSchema.index({ asset_id: 1, start_time: -1 });
PlaybackLogSchema.index({ start_time: -1 });
PlaybackLogSchema.index({ playlist_id: 1, start_time: -1 });
PlaybackLogSchema.index({ device_id: 1, asset_id: 1, start_time: -1 });

// Export the model
export default mongoose.models.PlaybackLog ||
  mongoose.model<IPlaybackLog>("PlaybackLog", PlaybackLogSchema);
