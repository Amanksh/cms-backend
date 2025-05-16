import { Router } from "express";
import { getDisplayByDeviceId } from "../controllers/display.controller";

const router = Router();

// Get display and playlist by device ID
router.get("/device/:deviceId", getDisplayByDeviceId);

export const displayRoutes = router;
