import { Request, Response } from "express";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

// Initialize Resend client with API key from environment variables
const resend = new Resend(process.env.RESEND_API_KEY as string);
const toEmail = process.env.TO_EMAIL as string;

interface QuoteRequest {
  product: {
    // Basic product info
    id: string;
    name: string;
    category: string;
    // Display specifications
    pixelPitch: number;
    resolution: {
      width: number;
      height: number;
    };
    cabinetDimensions: {
      width: number;
      height: number;
    };
    // Module details
    moduleDimensions: {
      width: number;
      height: number;
    };
    moduleResolution: {
      width: number;
      height: number;
    };
    moduleQuantity: number;
    // Technical specifications
    pixelDensity: number;
    brightness: number;
    refreshRate: number;
    environment: string;
    maxPowerConsumption: number;
    avgPowerConsumption: number;
    weightPerCabinet: number;
    // Pricing
    processorPrice?: number;
    // User info
    userType: 'endUser' | 'siChannel' | 'reseller';
  };
  // Display configuration
  cabinetGrid?: {
    columns: number;
    rows: number;
  };
  // User message
  message: string;
  // Calculated display info
  displaySize?: {
    width: number;
    height: number;
  };
  aspectRatio?: string;
  // Additional options
  processor?: string;
  mode?: string;
  // User type at root level for backward compatibility
  userType?: 'endUser' | 'siChannel' | 'reseller';
  // Total price calculation
  totalPrice?: number;
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
  const userType = data.userType || data.product.userType;
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Quote Request</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          background-color: #f8f9fa;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 700px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 600;
        }
        .header p {
          margin: 10px 0 0 0;
          opacity: 0.9;
          font-size: 16px;
        }
        .content {
          padding: 30px;
        }
        .section {
          margin-bottom: 30px;
          border-bottom: 1px solid #e9ecef;
          padding-bottom: 20px;
        }
        .section:last-child {
          border-bottom: none;
          margin-bottom: 0;
        }
        .section h2 {
          color: #495057;
          font-size: 20px;
          margin-bottom: 15px;
          padding-bottom: 8px;
          border-bottom: 2px solid #667eea;
          display: inline-block;
        }
        .info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 15px;
          margin-top: 15px;
        }
        .info-item {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 8px;
          border-left: 4px solid #667eea;
        }
        .info-item strong {
          color: #495057;
          display: block;
          margin-bottom: 5px;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .info-item span {
          color: #212529;
          font-size: 16px;
          font-weight: 500;
        }
        .message-box {
          background: #e3f2fd;
          border: 1px solid #bbdefb;
          border-radius: 8px;
          padding: 20px;
          margin-top: 15px;
        }
        .message-box h3 {
          color: #1976d2;
          margin-top: 0;
          margin-bottom: 10px;
        }
        .footer {
          background: #f8f9fa;
          padding: 20px 30px;
          text-align: center;
          color: #6c757d;
          font-size: 14px;
        }
        .user-type-badge {
          display: inline-block;
          background: #28a745;
          color: white;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .user-type-badge.endUser { background: #007bff; }
        .user-type-badge.siChannel { background: #17a2b8; }
        .user-type-badge.reseller { background: #28a745; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📧 New Quote Request</h1>
          <p>Orion-Connect Display Solutions</p>
          <div class="user-type-badge ${userType}">${userType}</div>
        </div>
        
        <div class="content">
          <!-- Product Information -->
          <div class="section">
            <h2>🖥️ Product Information</h2>
            <div class="info-grid">
              <div class="info-item">
                <strong>Product ID</strong>
                <span>${data.product.id}</span>
              </div>
              <div class="info-item">
                <strong>Product Name</strong>
                <span>${data.product.name}</span>
              </div>
              <div class="info-item">
                <strong>Category</strong>
                <span>${data.product.category}</span>
              </div>
              <div class="info-item">
                <strong>Pixel Pitch</strong>
                <span>${data.product.pixelPitch}mm</span>
              </div>
            </div>
          </div>

          <!-- Display Specifications -->
          <div class="section">
            <h2>📐 Display Specifications</h2>
            <div class="info-grid">
              <div class="info-item">
                <strong>Resolution</strong>
                <span>${data.product.resolution.width} × ${data.product.resolution.height}</span>
              </div>
              <div class="info-item">
                <strong>Cabinet Dimensions</strong>
                <span>${data.product.cabinetDimensions.width}mm × ${data.product.cabinetDimensions.height}mm</span>
              </div>
              <div class="info-item">
                <strong>Module Dimensions</strong>
                <span>${data.product.moduleDimensions.width}mm × ${data.product.moduleDimensions.height}mm</span>
              </div>
              <div class="info-item">
                <strong>Module Resolution</strong>
                <span>${data.product.moduleResolution.width} × ${data.product.moduleResolution.height}</span>
              </div>
              <div class="info-item">
                <strong>Module Quantity</strong>
                <span>${data.product.moduleQuantity}</span>
              </div>
              ${data.displaySize ? `
              <div class="info-item">
                <strong>Display Size</strong>
                <span>${data.displaySize.width}m × ${data.displaySize.height}m</span>
              </div>
              ` : ''}
              ${data.aspectRatio ? `
              <div class="info-item">
                <strong>Aspect Ratio</strong>
                <span>${data.aspectRatio}</span>
              </div>
              ` : ''}
            </div>
          </div>

          <!-- Technical Specifications -->
          <div class="section">
            <h2>⚙️ Technical Specifications</h2>
            <div class="info-grid">
              <div class="info-item">
                <strong>Pixel Density</strong>
                <span>${data.product.pixelDensity} PPI</span>
              </div>
              <div class="info-item">
                <strong>Brightness</strong>
                <span>${data.product.brightness} nits</span>
              </div>
              <div class="info-item">
                <strong>Refresh Rate</strong>
                <span>${data.product.refreshRate} Hz</span>
              </div>
              <div class="info-item">
                <strong>Environment</strong>
                <span>${data.product.environment}</span>
              </div>
              <div class="info-item">
                <strong>Max Power Consumption</strong>
                <span>${data.product.maxPowerConsumption}W</span>
              </div>
              <div class="info-item">
                <strong>Avg Power Consumption</strong>
                <span>${data.product.avgPowerConsumption}W</span>
              </div>
              <div class="info-item">
                <strong>Weight Per Cabinet</strong>
                <span>${data.product.weightPerCabinet}kg</span>
              </div>
              ${data.product.processorPrice ? `
              <div class="info-item">
                <strong>Processor Price</strong>
                <span>₹${data.product.processorPrice}</span>
              </div>
              ` : ''}
            </div>
          </div>

          <!-- Pricing Information -->
          ${data.totalPrice ? `
          <div class="section">
            <h2>💰 Pricing Information</h2>
            <div class="info-grid">
              <div class="info-item" style="background: #e8f5e8; border-left-color: #28a745;">
                <strong>Total Price</strong>
                <span style="color: #28a745; font-size: 18px; font-weight: 600;">₹${data.totalPrice.toLocaleString()}</span>
              </div>
              ${data.product.processorPrice ? `
              <div class="info-item">
                <strong>Processor Cost</strong>
                <span>₹${data.product.processorPrice.toLocaleString()}</span>
              </div>
              ` : ''}
            </div>
          </div>
          ` : ''}

          <!-- Display Configuration -->
          ${data.cabinetGrid ? `
          <div class="section">
            <h2>🔲 Display Configuration</h2>
            <div class="info-grid">
              <div class="info-item">
                <strong>Cabinet Grid</strong>
                <span>${data.cabinetGrid.columns} columns × ${data.cabinetGrid.rows} rows</span>
              </div>
            </div>
          </div>
          ` : ''}

          <!-- Additional Options -->
          ${(data.processor || data.mode) ? `
          <div class="section">
            <h2>🔧 Additional Options</h2>
            <div class="info-grid">
              ${data.processor ? `
              <div class="info-item">
                <strong>Processor</strong>
                <span>${data.processor}</span>
              </div>
              ` : ''}
              ${data.mode ? `
              <div class="info-item">
                <strong>Mode</strong>
                <span>${data.mode}</span>
              </div>
              ` : ''}
            </div>
          </div>
          ` : ''}

          <!-- Customer Message -->
          <div class="section">
            <h2>💬 Customer Message</h2>
            <div class="message-box">
              <h3>Message from ${userType}</h3>
              <p>${data.message.replace(/\n/g, '<br>')}</p>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>This quote request was submitted through the Orion-Connect website.</p>
          <p>© ${new Date().getFullYear()} Orion-Connect. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Helper function to generate plain text email
function generatePlainTextQuoteRequest(data: QuoteRequest): string {
  const userType = data.userType || data.product.userType;
  
  let text = `NEW QUOTE REQUEST\n`;
  text += `Orion-Connect Display Solutions\n`;
  text += `User Type: ${userType}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n`;
  text += `Time: ${new Date().toLocaleTimeString()}\n\n`;
  
  text += `PRODUCT INFORMATION\n`;
  text += `==================\n`;
  text += `Product ID: ${data.product.id}\n`;
  text += `Product Name: ${data.product.name}\n`;
  text += `Category: ${data.product.category}\n`;
  text += `Pixel Pitch: ${data.product.pixelPitch}mm\n\n`;
  
  text += `DISPLAY SPECIFICATIONS\n`;
  text += `=====================\n`;
  text += `Resolution: ${data.product.resolution.width} × ${data.product.resolution.height}\n`;
  text += `Cabinet Dimensions: ${data.product.cabinetDimensions.width}mm × ${data.product.cabinetDimensions.height}mm\n`;
  text += `Module Dimensions: ${data.product.moduleDimensions.width}mm × ${data.product.moduleDimensions.height}mm\n`;
  text += `Module Resolution: ${data.product.moduleResolution.width} × ${data.product.moduleResolution.height}\n`;
  text += `Module Quantity: ${data.product.moduleQuantity}\n`;
  
  if (data.displaySize) {
    text += `Display Size: ${data.displaySize.width}mm × ${data.displaySize.height}mm\n`;
  }
  if (data.aspectRatio) {
    text += `Aspect Ratio: ${data.aspectRatio}\n`;
  }
  text += `\n`;
  
  text += `TECHNICAL SPECIFICATIONS\n`;
  text += `======================\n`;
  text += `Pixel Density: ${data.product.pixelDensity} PPI\n`;
  text += `Brightness: ${data.product.brightness} nits\n`;
  text += `Refresh Rate: ${data.product.refreshRate} Hz\n`;
  text += `Environment: ${data.product.environment}\n`;
  text += `Max Power Consumption: ${data.product.maxPowerConsumption}W\n`;
  text += `Avg Power Consumption: ${data.product.avgPowerConsumption}W\n`;
  text += `Weight Per Cabinet: ${data.product.weightPerCabinet}kg\n`;
  
  if (data.product.processorPrice) {
    text += `Processor Price: ₹${data.product.processorPrice}\n`;
  }
  text += `\n`;
  
  if (data.totalPrice) {
    text += `PRICING INFORMATION\n`;
    text += `===================\n`;
    text += `Total Price: ₹${data.totalPrice.toLocaleString()}\n`;
    if (data.product.processorPrice) {
      text += `Processor Cost: ₹${data.product.processorPrice.toLocaleString()}\n`;
    }
    text += `\n`;
  }
  
  if (data.cabinetGrid) {
    text += `DISPLAY CONFIGURATION\n`;
    text += `====================\n`;
    text += `Cabinet Grid: ${data.cabinetGrid.columns} columns × ${data.cabinetGrid.rows} rows\n\n`;
  }
  
  if (data.processor || data.mode) {
    text += `ADDITIONAL OPTIONS\n`;
    text += `==================\n`;
    if (data.processor) text += `Processor: ${data.processor}\n`;
    if (data.mode) text += `Mode: ${data.mode}\n`;
    text += `\n`;
  }
  
  text += `CUSTOMER MESSAGE\n`;
  text += `================\n`;
  text += `Message from ${userType}:\n`;
  text += `${data.message}\n\n`;
  
  text += `---\n`;
  text += `This quote request was submitted through the Orion-Connect website.\n`;
  text += `© ${new Date().getFullYear()} Orion-Connect. All rights reserved.\n`;
  
  return text;
}
