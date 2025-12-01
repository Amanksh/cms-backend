import mongoose, { Schema, Document } from "mongoose";

/**
 * PlaybackLog Model
 * 
 * This model stores proof-of-play data from digital signage players.
 * Each record represents a single asset playback event on a specific device.
 * 
 * Field names match EXACTLY what Android Player sends:
 * - deviceId (not device_id)
 * - assetId (not asset_id)
 * - playlistId (not playlist_id)
 * - startTime (not start_time)
 * - endTime (not end_time)
 */

// TypeScript interface for PlaybackLog document
export interface IPlaybackLog extends Document {
  deviceId: string;       // Unique identifier of the player device
  assetId: string;        // ID or filename of the played asset
  playlistId?: string;    // Optional: ID of the playlist containing the asset
  startTime: Date;        // When the asset started playing
  endTime: Date;          // When the asset finished playing
  duration: number;       // Duration in seconds
  createdAt: Date;        // When this log record was created
}

// Mongoose schema definition
const PlaybackLogSchema = new Schema<IPlaybackLog>(
  {
    deviceId: {
      type: String,
      required: [true, "deviceId is required"],
      trim: true,
    },
    assetId: {
      type: String,
      required: [true, "assetId is required"],
      trim: true,
    },
    playlistId: {
      type: String,
      trim: true,
      default: null,
    },
    startTime: {
      type: Date,
      required: [true, "startTime is required"],
    },
    endTime: {
      type: Date,
      required: [true, "endTime is required"],
    },
    duration: {
      type: Number,
      required: [true, "duration is required"],
      min: [0, "duration must be a positive number"],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // Disable Mongoose's default timestamps since we're using createdAt manually
    timestamps: false,
    // Collection name in MongoDB
    collection: "playback_logs",
  }
);

/**
 * Indexes for optimized query performance
 */
PlaybackLogSchema.index({ deviceId: 1, startTime: -1 });
PlaybackLogSchema.index({ assetId: 1, startTime: -1 });
PlaybackLogSchema.index({ startTime: -1 });
PlaybackLogSchema.index({ playlistId: 1, startTime: -1 });
PlaybackLogSchema.index({ deviceId: 1, assetId: 1, startTime: -1 });

// Export the model
export default mongoose.models.PlaybackLog ||
  mongoose.model<IPlaybackLog>("PlaybackLog", PlaybackLogSchema);
