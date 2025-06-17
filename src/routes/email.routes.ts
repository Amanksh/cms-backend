import { Router } from "express";
import { handleQuoteRequest } from "../controllers/emailController";

const router = Router();

/**
 * @route   POST /api/email/quote-request
 * @desc    Handle quote request submissions
 * @access  Public
 */
router.post("/quota", handleQuoteRequest);

export const emailRoutes = router;