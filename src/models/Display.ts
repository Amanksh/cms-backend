import mongoose, { Schema, Document } from "mongoose";

/**
 * Display Model
 * 
 * Represents a digital signage display/player device.
 * Each display can have a playlist assigned to it.
 */

export interface IDisplay extends Document {
  name: string;
  deviceId: string;
  location: string;
  status: "online" | "offline" | "maintenance";
  resolution: string;
  playlistId?: mongoose.Types.ObjectId;
  userId: string;
  lastActive: Date;
  totalHours: number;
  createdAt: Date;
  updatedAt: Date;
}

const DisplaySchema = new Schema<IDisplay>(
  {
    name: {
      type: String,
      required: [true, "Display name is required"],
      trim: true,
    },
    deviceId: {
      type: String,
      required: [true, "Device ID is required"],
      unique: true,
      trim: true,
    },
    location: {
      type: String,
      required: [true, "Location is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ["online", "offline", "maintenance"],
        message: "Status must be online, offline, or maintenance",
      },
      default: "offline",
    },
    resolution: {
      type: String,
      required: [true, "Resolution is required"],
      trim: true,
    },
    playlistId: {
      type: Schema.Types.ObjectId,
      ref: "Playlist",
    },
    userId: {
      type: String,
      required: [true, "User ID is required"],
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
    totalHours: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
DisplaySchema.index({ userId: 1 });
DisplaySchema.index({ deviceId: 1 });
DisplaySchema.index({ status: 1 });

export default mongoose.models.Display ||
  mongoose.model<IDisplay>("Display", DisplaySchema);
