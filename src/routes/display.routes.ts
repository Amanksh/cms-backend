import { Router } from "express";
import { getDisplayByDeviceId, trackPlayback } from "../controllers/display.controller";

const router = Router();

// Track display playback
router.post("/playback/:deviceId", trackPlayback);

// Get display and playlist by device ID
router.get("/device/:deviceId", getDisplayByDeviceId);

export const displayRoutes = router;
