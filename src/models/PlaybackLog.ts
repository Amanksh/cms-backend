import mongoose, { Schema, Document } from "mongoose";

/**
 * PlaybackLog Model
 * 
 * This model stores proof-of-play data from digital signage players.
 * Each record represents a single asset playback event on a specific device.
 * 
 * Designed to handle millions of records with:
 * - Compound indexes for efficient querying
 * - Optimized for time-range and device/asset filtering
 */

// TypeScript interface for PlaybackLog document
export interface IPlaybackLog extends Document {
  device_id: string;      // Unique identifier of the player device
  asset_id: string;       // ID or filename of the played asset
  playlist_id?: string;   // Optional: ID of the playlist containing the asset
  start_time: Date;       // When the asset started playing
  end_time: Date;         // When the asset finished playing
  duration: number;       // Duration in seconds
  created_at: Date;       // When this log record was created
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
    // Disable Mongoose's default timestamps since we're using created_at manually
    timestamps: false,
    // Collection name in MongoDB
    collection: "playback_logs",
  }
);

/**
 * Indexes for optimized query performance
 * 
 * 1. Compound index on device_id + start_time: 
 *    - Fast queries for "all playbacks from device X in time range"
 * 
 * 2. Compound index on asset_id + start_time:
 *    - Fast queries for "all playbacks of asset Y in time range"
 * 
 * 3. Single index on start_time:
 *    - Fast time-range queries across all devices/assets
 * 
 * 4. Compound index on playlist_id + start_time:
 *    - Fast queries for playlist-specific reports
 */
PlaybackLogSchema.index({ device_id: 1, start_time: -1 });
PlaybackLogSchema.index({ asset_id: 1, start_time: -1 });
PlaybackLogSchema.index({ start_time: -1 });
PlaybackLogSchema.index({ playlist_id: 1, start_time: -1 });

// Compound index for report aggregation queries
PlaybackLogSchema.index({ device_id: 1, asset_id: 1, start_time: -1 });

// Export the model
export default mongoose.models.PlaybackLog ||
  mongoose.model<IPlaybackLog>("PlaybackLog", PlaybackLogSchema);

