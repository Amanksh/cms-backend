import { Request, Response } from "express";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

// Initialize Resend client with API key from environment variables
const resend = new Resend(process.env.RESEND_API_KEY as string);
const toEmail = process.env.TO_EMAIL as string;

interface QuoteRequest {
  product: {
    name: string;
    pixelPitch?: number;
    resolution?: {
      width: number;
      height: number;
    };
    cabinetDimensions?: {
      width: number;
      height: number;
    };
  };
  cabinetGrid?: {
    columns: number;
    rows: number;
  };
  message: string;
  displaySize?: {
    width: number;
    height: number;
  };
  aspectRatio?: string;
}

/**
 * POST /api/email/quote-request
 * 
 * Handles quote request submissions and sends formatted emails
 */
export const handleQuoteRequest = async (req: Request, res: Response) => {
  try {
    const quoteData: QuoteRequest = req.body;

    // Basic validation
    if (!quoteData.product?.name || !quoteData.message) {
      return res.status(400).json({
        success: false,
        message: "Product name and message are required fields"
      });
    }

    // Format the email content
    const emailHtml = generateQuoteRequestEmail(quoteData);
    const emailText = generatePlainTextQuoteRequest(quoteData);

    // Send the email
    const response = await resend.emails.send({
      from: process.env.DEFAULT_FROM_EMAIL || "Orion-Connect <no-reply@orionconnect.in>",
      to: toEmail,
      subject: `New Quote Request: ${quoteData.product.name}`,
      html: emailHtml,
      text: emailText,
    });

    return res.json({ 
      success: true, 
      message: "Quote request submitted successfully",
      data: response 
    });

  } catch (error: any) {
    console.error("[QUOTE_REQUEST]", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to process quote request",
    });
  }
};

// Helper function to generate HTML email
function generateQuoteRequestEmail(data: QuoteRequest): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>New Quote Request</h2>
      
      <h3>Product Details</h3>
      <p><strong>Name:</strong> ${data.product.name}</p>
      ${data.product.pixelPitch ? `<p><strong>Pixel Pitch:</strong> ${data.product.pixelPitch}mm</p>` : ''}
      
      ${data.product.resolution ? `
        <p><strong>Resolution:</strong> 
          ${data.product.resolution.width} x ${data.product.resolution.height}
        </p>
      ` : ''}
      
      ${data.product.cabinetDimensions ? `
        <p><strong>Cabinet Dimensions:</strong> 
          ${data.product.cabinetDimensions.width}mm x ${data.product.cabinetDimensions.height}mm
        </p>
      ` : ''}
      
      ${data.cabinetGrid ? `
        <h3>Cabinet Grid</h3>
        <p>${data.cabinetGrid.columns} columns × ${data.cabinetGrid.rows} rows</p>
      ` : ''}
      
      ${data.displaySize ? `
        <h3>Display Size</h3>
        <p>${data.displaySize.width}mm × ${data.displaySize.height}mm</p>
      ` : ''}
      
      ${data.aspectRatio ? `
        <p><strong>Aspect Ratio:</strong> ${data.aspectRatio}</p>
      ` : ''}
      
      <h3>Message</h3>
      <p>${data.message.replace(/\n/g, '<br>')}</p>
      
      <hr>
      <p style="color: #666; font-size: 0.9em;">
        This quote request was submitted through the Orion-Connect website.
      </p>
    </div>
  `;
}

// Helper function to generate plain text email
function generatePlainTextQuoteRequest(data: QuoteRequest): string {
  let text = `New Quote Request\n\n`;
  text += `PRODUCT DETAILS\n`;
  text += `Name: ${data.product.name}\n`;
  
  if (data.product.pixelPitch) text += `Pixel Pitch: ${data.product.pixelPitch}mm\n`;
  
  if (data.product.resolution) {
    text += `Resolution: ${data.product.resolution.width} x ${data.product.resolution.height}\n`;
  }
  
  if (data.product.cabinetDimensions) {
    text += `Cabinet Dimensions: ${data.product.cabinetDimensions.width}mm x ${data.product.cabinetDimensions.height}mm\n`;
  }
  
  if (data.cabinetGrid) {
    text += `\nCABINET GRID\n`;
    text += `${data.cabinetGrid.columns} columns × ${data.cabinetGrid.rows} rows\n`;
  }
  
  if (data.displaySize) {
    text += `\nDISPLAY SIZE\n`;
    text += `${data.displaySize.width}mm × ${data.displaySize.height}mm\n`;
  }
  
  if (data.aspectRatio) {
    text += `Aspect Ratio: ${data.aspectRatio}\n`;
  }
  
  text += `\nMESSAGE\n${data.message}\n\n`;
  text += "---\n";
  text += "This quote request was submitted through the Orion-Connect website.\n";
  
  return text;
}
