import mongoose, { Schema, Document } from "mongoose";

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
    name: { type: String, required: true },
    deviceId: { type: String, required: true, unique: true },
    location: { type: String, required: true },
    status: {
      type: String,
      enum: ["online", "offline", "maintenance"],
      default: "offline",
    },
    resolution: { type: String, required: true },
    playlistId: { type: Schema.Types.ObjectId, ref: "Playlist" },
    userId: { type: String, required: true },
    lastActive: { type: Date, default: Date.now },
    totalHours: { type: Number, default: 0 }, // Total hours in minutes
  },
  { timestamps: true }
);

export default mongoose.models.Display ||
  mongoose.model<IDisplay>("Display", DisplaySchema);
