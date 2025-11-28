/**
 * Global Error Handler Middleware
 * 
 * Catches all errors and returns consistent error responses.
 */

import { Request, Response, NextFunction } from "express";
import { config } from "../config";

// Custom error class for API errors
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Error response interface
interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
  stack?: string;
}

/**
 * Global error handler middleware
 */
export const errorHandler = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log error
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);

  // Default error values
  let statusCode = 500;
  let message = "Internal server error";

  // Handle known API errors
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
  }

  // Handle Mongoose validation errors
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = err.message;
  }

  // Handle Mongoose cast errors (invalid ObjectId)
  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid ID format";
  }

  // Handle duplicate key errors
  if ((err as any).code === 11000) {
    statusCode = 409;
    message = "Duplicate entry";
  }

  // Build response
  const response: ErrorResponse = {
    success: false,
    message,
  };

  // Include stack trace in development
  if (config.isDevelopment) {
    response.error = err.message;
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  });
};

