import { Request, Response } from "express";
import Display from "../models/Display";

export const trackPlayback = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body;

    // Find the display and update lastActive and totalHours
    const display = await Display.findOneAndUpdate(
      { deviceId },
      {
        $set: { lastActive: new Date() },
        $inc: { totalHours: 5 } // Adding 5 minutes to totalHours
      },
      { new: true }
    );

    if (!display) {
      return res.status(404).json({ message: "Display not found" });
    }

    return res.json({
      success: true,
      message: "Playback tracked successfully",
      lastActive: display.lastActive,
      totalHours: display.totalHours
    });
  } catch (error) {
    console.error("Error tracking playback:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getDisplayByDeviceId = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    const display = await Display.findOne({ deviceId }).populate({
      path: "playlistId",
      populate: {
        path: "items.assetId",
      },
    });

    if (!display) {
      return res.status(404).json({ message: "Display not found" });
    }

    // Update last active timestamp and status
    display.lastActive = new Date();
    display.status = "online";
    await display.save();

    // If no playlist is assigned, return empty playlist
    if (!display.playlistId) {
      return res.json({
        displayId: display._id,
        name: display.name,
        resolution: display.resolution,
        playlist: null,
      });
    }

    // Return the playlist with all its items and assets
    return res.json({
      displayId: display._id,
      name: display.name,
      resolution: display.resolution,
      playlist: {
        _id: display.playlistId._id,
        name: display.playlistId.name,
        description: display.playlistId.description,
        status: display.playlistId.status,
        items: display.playlistId.items.map((item: any) => ({
          assetId: {
            _id: item.assetId._id,
            name: item.assetId.name,
            type: item.assetId.type,
            url: item.assetId.url,
            thumbnail: item.assetId.thumbnail,
            duration: item.assetId.duration,
            size: item.assetId.size,
          },
          duration: item.duration,
          order: item.order,
        })),
        schedule: display.playlistId.schedule,
      },
    });
  } catch (error) {
    console.error("[DISPLAY_GET]", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
