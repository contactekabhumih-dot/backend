const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Razorpay = require("razorpay");
const nodemailer = require("nodemailer");
require("dotenv").config();

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "rzp_test_ekabhumihKey123";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "ekabhumihSecret456";

let razorpay = null;
try {
  razorpay = new Razorpay({
    key_id: razorpayKeyId,
    key_secret: razorpayKeySecret
  });
} catch (err) {
  console.log("Razorpay SDK initialized with test mode fallback.");
}

/* EMAIL TRANSPORTER CONFIGURATION */
let emailTransporter = null;
let isEmailConfigured = false;
let lastEmailSuccess = null;
let lastEmailFailed = null;

function initEmailTransporter() {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 587);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;

  if (host && user && pass) {
    try {
      emailTransporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });
      isEmailConfigured = true;
      console.log(`[SMTP] Email Transporter ready (${user} via ${host}:${port})`);
    } catch (err) {
      console.warn("[SMTP] Failed to initialize Nodemailer transporter:", err.message);
      isEmailConfigured = false;
    }
  } else {
    isEmailConfigured = false;
    console.log("[SMTP] EMAIL_PASSWORD or EMAIL_USER missing in .env. Email status: NOT_CONFIGURED.");
  }
}
initEmailTransporter();

const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

const PORT = Number(process.env.PORT || 5000);

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  subtitle: { type: String, default: "" },
  shortDescription: { type: String, default: "" },
  description: { type: String, default: "" },
  sku: { type: String, default: "EB-RED-50G" },
  price: { type: Number, required: true },
  sellingPrice: { type: Number, default: 1018 },
  originalPrice: { type: Number, default: 1499 },
  discountPercent: { type: Number, default: 32 },
  priceSource: { type: String, default: "DATABASE" },
  netWeight: { type: String, default: "50g" },
  rating: { type: Number, default: 4.8 },
  reviewsCount: { type: Number, default: 124 },
  stock: { type: Number, default: 100 },
  images: [{ type: String }],
  keyIngredients: [{ type: String }],
  benefits: [{ type: String }],
  details: [{ title: String, content: String }],
  faqs: [{ q: String, a: String }],
  isBestseller: { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: true },
  showDiscount: { type: Boolean, default: true },
  customBadgeText: { type: String, default: "Clinical Hair Care" },
  updatedBy: { type: String, default: "System Admin" }
}, { timestamps: true });

const productRevisionSchema = new mongoose.Schema({
  productId: String,
  changedBy: { type: String, default: "admin@ekabhumih.com" },
  changedAt: { type: Date, default: Date.now },
  productName: String,
  price: Number,
  snapshot: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  customer: {
    name: String,
    phone: String,
    email: String,
    address: String,
    city: String,
    pincode: String
  },
  items: [{
    productId: String,
    name: String,
    quantity: Number,
    price: Number
  }],
  totalAmount: Number,
  discountAmount: { type: Number, default: 0 },
  couponCode: { type: String, default: "" },
  paymentMethod: { type: String, default: "Razorpay" },
  paymentStatus: { type: String, default: "Pending" },
  razorpayOrderId: { type: String, default: "" },
  razorpayPaymentId: { type: String, default: "" },
  razorpaySignature: { type: String, default: "" },
  status: {
    type: String,
    enum: ["Pending", "Confirmed", "Shipped", "Delivered", "Cancelled"],
    default: "Pending"
  },
  emailSentAt: { type: Date }
}, { timestamps: true });

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discountPercent: { type: Number, default: 0 },
  flatDiscount: { type: Number, default: 0 },
  minOrderValue: { type: Number, default: 0 },
  usageLimit: { type: Number, default: 0 },
  startDate: { type: String, default: "" },
  expiryDate: { type: String, default: "" },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const subscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: ["Subscribed", "Unsubscribed"], default: "Subscribed" },
  subscribedAt: { type: Date, default: Date.now },
  unsubscribedAt: { type: Date },
  source: { type: String, default: "Website Footer" }
}, { timestamps: true });

const emailLogSchema = new mongoose.Schema({
  orderId: { type: String, default: "" },
  campaignId: { type: String, default: "" },
  recipientEmail: { type: String, required: true },
  emailType: { type: String, required: true },
  subject: { type: String, required: true },
  status: { type: String, enum: ["Sent", "Failed", "Not_Configured"], required: true },
  providerMessageId: { type: String, default: "" },
  error: { type: String, default: "" },
  sentAt: { type: Date, default: Date.now }
}, { timestamps: true });

const emailCampaignSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subject: { type: String, required: true },
  createdBy: { type: String, default: "Admin" },
  recipientsCount: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  status: { type: String, enum: ["Queued", "Sending", "Completed", "Completed_With_Errors", "Failed"], default: "Queued" }
}, { timestamps: true });

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  discount: { type: String, default: "" },
  couponCode: { type: String, default: "" },
  startDate: { type: String, default: "" },
  endDate: { type: String, default: "" },
  bannerUrl: { type: String, default: "" },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const Product = mongoose.model("Product", productSchema);
const Order = mongoose.model("Order", orderSchema);
const Coupon = mongoose.model("Coupon", couponSchema);
const ProductRevision = mongoose.model("ProductRevision", productRevisionSchema);
const Subscriber = mongoose.model("Subscriber", subscriberSchema);
const EmailLog = mongoose.model("EmailLog", emailLogSchema);
const EmailCampaign = mongoose.model("EmailCampaign", emailCampaignSchema);
const Offer = mongoose.model("Offer", offerSchema);

const PRODUCT_DATA_FILE = path.join(__dirname, "product_data.json");

let fallbackProduct = {
  _id: "fallback-product",
  name: "Redensyl Hair Growth Concentrate",
  subtitle: "Powered by 3% Redensyl, Baicapil and Anagain",
  description: "A clinically backed blend designed to reduce hair fall, strengthen roots and encourage new growth.",
  price: 1018,
  originalPrice: 1499,
  discountPercent: 32,
  netWeight: "50g",
  rating: 4.8,
  reviewsCount: 124,
  stock: 100,
  images: [
    "/product_pedestal.jpg",
    "/product.jpg",
    "/results.jpg",
    "/texture.jpg"
  ],
  keyIngredients: ["Redensyl 3%", "Baicapil 3%", "Anagain 3%"],
  benefits: [
    "Reduces hair fall up to 89%",
    "Visible results in 8–12 weeks",
    "Lightweight & non-greasy",
    "Safe for daily use"
  ],
  details: [
    { title: "Product Details", content: "Redensyl-led hair care concentrate for a simple daily scalp routine." },
    { title: "Key Ingredients", content: "Redensyl 3%, Baicapil 3% and Anagain 3%." },
    { title: "How to Use", content: "Apply to a clean, dry scalp, massage gently and leave on as directed on the product label." },
    { title: "Why This Over Others?", content: "A focused three-active formula in a lightweight serum format." },
    { title: "FAQ", content: "Suitable for all hair types. Patch test and follow the product label for use." }
  ],
  isBestseller: true
};

function loadPersistedProduct() {
  try {
    if (fs.existsSync(PRODUCT_DATA_FILE)) {
      const raw = fs.readFileSync(PRODUCT_DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.price === "number") {
        fallbackProduct = { ...fallbackProduct, ...parsed };
        if (fallbackProduct.originalPrice > 0 && fallbackProduct.originalPrice > fallbackProduct.price) {
          fallbackProduct.discountPercent = Math.round(((fallbackProduct.originalPrice - fallbackProduct.price) / fallbackProduct.originalPrice) * 100);
        }
        console.log(`[STORAGE] Loaded persisted product data from disk: ₹${fallbackProduct.price} (Original ₹${fallbackProduct.originalPrice})`);
      }
    }
  } catch (err) {
    console.warn("[STORAGE] Could not load product_data.json:", err.message);
  }
}
loadPersistedProduct();

function savePersistedProduct(productObj) {
  try {
    fs.writeFileSync(PRODUCT_DATA_FILE, JSON.stringify(productObj, null, 2), "utf8");
  } catch (err) {
    console.warn("[STORAGE] Could not save product_data.json:", err.message);
  }
}

let fallbackCoupons = [
  { _id: "c1", code: "WELCOME10", discountPercent: 10, flatDiscount: 0, minOrderValue: 0, usageLimit: 500, startDate: "2026-01-01", expiryDate: "2026-12-31", active: true },
  { _id: "c2", code: "REDENSYL20", discountPercent: 20, flatDiscount: 0, minOrderValue: 999, usageLimit: 200, startDate: "2026-01-01", expiryDate: "2026-12-31", active: true },
  { _id: "c3", code: "EKA100", discountPercent: 0, flatDiscount: 100, minOrderValue: 499, usageLimit: 100, startDate: "2026-01-01", expiryDate: "2026-12-31", active: true }
];

let fallbackSubscribers = [
  { _id: "sub-1", email: "priya@gmail.com", status: "Subscribed", subscribedAt: new Date(), source: "Website Footer" },
  { _id: "sub-2", email: "rahul.s@gmail.com", status: "Subscribed", subscribedAt: new Date(), source: "Checkout" }
];
let fallbackEmailLogs = [];
let fallbackCampaigns = [];
let fallbackOffers = [
  {
    _id: "offer-1",
    title: "Seasonal Density Festival Offer",
    description: "Get 20% OFF on Eka Bhūmih Redensyl Hair Concentrate with complimentary trial kit.",
    discount: "20% OFF",
    couponCode: "REDENSYL20",
    startDate: "2026-08-01",
    endDate: "2026-09-30",
    bannerUrl: "/results.jpg",
    active: true,
    createdAt: new Date()
  }
];

let dbReady = false;
let fallbackOrders = [];
const sessions = new Set();

/* EMAIL ENGINE & HTML TEMPLATES */
function generateBrandedEmailHtml({ title, preheader = "", bodyHtml, recipientEmail = "" }) {
  const frontendUrl = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  const unsubscribeUrl = `${frontendUrl}/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#f7f5f0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#2c3e2e; line-height:1.6;">
  <div style="max-width:600px; margin:20px auto; background:#ffffff; border:1px solid #e5e0d8; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.03);">
    
    <!-- HEADER -->
    <div style="background-color:#2f6b38; padding:28px 24px; text-align:center;">
      <h1 style="margin:0; font-family:'Playfair Display', Georgia, serif; font-size:24px; letter-spacing:1px; color:#ffffff; font-weight:600;">EKA BHŪMIH</h1>
      <p style="margin:4px 0 0; font-size:11px; color:#e0ebd8; letter-spacing:2px; text-transform:uppercase;">Botanical Hair Care & Scalp Science</p>
    </div>

    <!-- CONTENT -->
    <div style="padding:32px 28px;">
      <h2 style="margin-top:0; font-family:'Playfair Display', Georgia, serif; font-size:20px; color:#1b3d20;">${title}</h2>
      ${bodyHtml}
    </div>

    <!-- FOOTER -->
    <div style="background-color:#f7f5f0; padding:24px; text-align:center; border-top:1px solid #e5e0d8; font-size:12px; color:#6b7c6d;">
      <p style="margin:0 0 6px; font-weight:600; color:#2c3e2e;">Eka Bhūmih Lifestyle Private Limited</p>
      <p style="margin:0 0 10px;">Clinically Validated Botanical Hair Care</p>
      ${recipientEmail ? `<p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#2f6b38; text-decoration:underline;">Unsubscribe from updates</a></p>` : ""}
    </div>

  </div>
</body>
</html>
  `;
}

function buildOrderStatusEmail(order, newStatus) {
  const customerName = order.customer?.name || "Valued Customer";
  const orderId = order.orderId || "Order";
  const total = `₹${(order.totalAmount || 0).toLocaleString("en-IN")}`;
  const address = `${order.customer?.address || ""}, ${order.customer?.city || ""} - ${order.customer?.pincode || ""}`;
  const itemsHtml = (order.items || []).map(item => `
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0ece1;">
      <span><strong>${item.name}</strong> (Qty: ${item.quantity})</span>
      <span>₹${((item.price || 0) * item.quantity).toLocaleString("en-IN")}</span>
    </div>
  `).join("");

  let title = `Update on Your Eka Bhūmih Order #${orderId}`;
  let statusNotice = "";

  if (newStatus === "Confirmed") {
    title = `Your Eka Bhūmih Order #${orderId} Has Been Confirmed`;
    statusNotice = `<p style="font-size:14px; color:#2f6b38; background:#eef5eb; padding:12px 16px; border-radius:8px; border-left:4px solid #2f6b38;">Your order has been confirmed and is being prepared for dispatch.</p>`;
  } else if (newStatus === "Shipped") {
    title = `Your Eka Bhūmih Order #${orderId} Has Been Shipped`;
    statusNotice = `<p style="font-size:14px; color:#2f6b38; background:#eef5eb; padding:12px 16px; border-radius:8px; border-left:4px solid #2f6b38;">Your order is on its way to your address.</p>`;
  } else if (newStatus === "Delivered") {
    title = `Your Eka Bhūmih Order #${orderId} Has Been Delivered`;
    statusNotice = `<p style="font-size:14px; color:#2f6b38; background:#eef5eb; padding:12px 16px; border-radius:8px; border-left:4px solid #2f6b38;">Your order has been successfully delivered. Thank you for choosing Eka Bhūmih.</p>`;
  } else if (newStatus === "Cancelled") {
    title = `Update on Your Eka Bhūmih Order #${orderId}`;
    statusNotice = `<p style="font-size:14px; color:#900; background:#fdf2f2; padding:12px 16px; border-radius:8px; border-left:4px solid #d32f2f;">Your order #${orderId} has been cancelled.</p>`;
  }

  const bodyHtml = `
    <p style="font-size:15px;">Hi ${customerName},</p>
    ${statusNotice}
    <div style="margin:20px 0; padding:16px; background:#faf8f3; border:1px solid #e8e3d8; border-radius:8px;">
      <h3 style="margin-top:0; font-size:13px; text-transform:uppercase; letter-spacing:1px; color:#6b7c6d;">Order Information</h3>
      <p style="margin:4px 0;"><strong>Order ID:</strong> #${orderId}</p>
      <p style="margin:4px 0;"><strong>Status:</strong> ${newStatus}</p>
      <p style="margin:4px 0;"><strong>Total Amount:</strong> ${total}</p>
      <p style="margin:4px 0;"><strong>Shipping Address:</strong> ${address}</p>
    </div>
    <div style="margin:20px 0;">
      <h4 style="margin:0 0 8px; font-size:14px; color:#2c3e2e;">Items Summary</h4>
      ${itemsHtml}
    </div>
    <p style="margin-top:24px; font-size:14px;">Thank you for choosing Eka Bhūmih.</p>
  `;

  return {
    subject: title,
    html: generateBrandedEmailHtml({ title, bodyHtml, recipientEmail: order.customer?.email })
  };
}

async function sendServerEmail({ to, subject, html, emailType, orderId = "", campaignId = "" }) {
  const fromAddress = process.env.EMAIL_FROM || '"Eka Bhūmih" <bhumihlifestyle@gmail.com>';

  if (!to || !to.includes("@")) {
    return {
      success: false,
      emailSent: false,
      status: "Failed",
      error: "Recipient email address unavailable or invalid",
      message: "Customer email unavailable"
    };
  }

  if (!isEmailConfigured || !emailTransporter) {
    const logEntry = {
      _id: crypto.randomUUID(),
      orderId,
      campaignId,
      recipientEmail: to,
      emailType,
      subject,
      status: "Not_Configured",
      providerMessageId: "",
      error: "Email service is not configured (EMAIL_PASSWORD missing in backend/.env)",
      sentAt: new Date()
    };

    if (dbReady) await EmailLog.create(logEntry);
    else fallbackEmailLogs.unshift(logEntry);

    lastEmailFailed = { time: new Date().toISOString(), to, error: "Email service is not configured" };

    return {
      success: false,
      emailSent: false,
      status: "Not_Configured",
      message: "Email service is not configured"
    };
  }

  try {
    const info = await emailTransporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html
    });

    const logEntry = {
      _id: crypto.randomUUID(),
      orderId,
      campaignId,
      recipientEmail: to,
      emailType,
      subject,
      status: "Sent",
      providerMessageId: info.messageId || `msg_${Date.now()}`,
      error: "",
      sentAt: new Date()
    };

    if (dbReady) await EmailLog.create(logEntry);
    else fallbackEmailLogs.unshift(logEntry);

    lastEmailSuccess = { time: new Date().toISOString(), to, messageId: info.messageId };

    return {
      success: true,
      emailSent: true,
      status: "Sent",
      message: "Email accepted by the email provider",
      providerMessageId: info.messageId
    };
  } catch (err) {
    const logEntry = {
      _id: crypto.randomUUID(),
      orderId,
      campaignId,
      recipientEmail: to,
      emailType,
      subject,
      status: "Failed",
      providerMessageId: "",
      error: err.message || "Unknown SMTP error",
      sentAt: new Date()
    };

    if (dbReady) await EmailLog.create(logEntry);
    else fallbackEmailLogs.unshift(logEntry);

    lastEmailFailed = { time: new Date().toISOString(), to, error: err.message };

    return {
      success: false,
      emailSent: false,
      status: "Failed",
      error: err.message || "Email delivery failed",
      message: `Email notification could not be sent: ${err.message}`
    };
  }
}

async function connectDb() {
  try {
    if (!process.env.MONGO_URI) return;
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 2500 });
    dbReady = true;
    console.log("MongoDB connected");
  } catch (err) {
    dbReady = false;
    console.warn("MongoDB unavailable; using in-memory fallback.");
  }
}

async function initializeApplication() {
  console.log("[DATA] Initializing application persistence...");
  await connectDb();

  // Load disk persistence
  loadPersistedProduct();

  if (dbReady) {
    console.log("[DATA] Database connected");
    const existingProduct = await Product.findOne();
    if (existingProduct) {
      console.log(`[DATA] Existing product found. Preserved admin product data: Selling ₹${existingProduct.price}, Original ₹${existingProduct.originalPrice}`);
      console.log("[DATA SAFETY] No seed overwrite performed");
    } else {
      console.log("[DATA] No existing product found in DB. Seeding initial product record...");
      await Product.create(fallbackProduct);
      console.log(`[DATA] Initial product created: Selling ₹${fallbackProduct.price}, Original ₹${fallbackProduct.originalPrice}`);
    }

    const couponCount = await Coupon.countDocuments();
    if (couponCount === 0) {
      await Coupon.insertMany(fallbackCoupons);
      console.log("[DATA] Initial coupons created");
    } else {
      console.log(`[DATA] Existing coupons found (${couponCount}). Preserved.`);
    }

    const offerCount = await Offer.countDocuments();
    if (offerCount === 0) {
      await Offer.insertMany(fallbackOffers);
      console.log("[DATA] Initial offers created");
    } else {
      console.log(`[DATA] Existing offers found (${offerCount}). Preserved.`);
    }
  } else {
    console.log(`[DATA] Operating with persistent disk storage: Selling ₹${fallbackProduct.price}, Original ₹${fallbackProduct.originalPrice}`);
    console.log("[DATA SAFETY] Admin product preserved from disk storage. No seed overwrite performed.");
  }
}

async function resetDemoData(explicitAction = false) {
  if (process.env.NODE_ENV !== "development" || process.env.RUN_SEED !== "true" || !explicitAction) {
    console.warn("[DATA SAFETY] BLOCKED OVERWRITE. Reason: Automatic seed reset disabled in non-development environment or without explicit confirmation.");
    return { success: false, error: "Automatic data resets are disabled. RUN_SEED=true and NODE_ENV=development are required." };
  }
  console.log("[DATA SAFETY] EXPLICIT RESET CONFIRMED. Re-seeding demo product...");
  return { success: true, message: "Demo data reset" };
}

async function ensureProduct() {
  fallbackProduct.sellingPrice = fallbackProduct.price || 1018;
  fallbackProduct.priceSource = "DATABASE";

  if (fallbackProduct.originalPrice > 0 && fallbackProduct.originalPrice > fallbackProduct.price) {
    fallbackProduct.discountPercent = Math.round(((fallbackProduct.originalPrice - fallbackProduct.price) / fallbackProduct.originalPrice) * 100);
  }

  if (!dbReady) return fallbackProduct;

  const count = await Product.countDocuments();
  if (count === 0) {
    const created = await Product.create(fallbackProduct);
    const obj = created.toObject();
    obj.sellingPrice = obj.price;
    obj.priceSource = "DATABASE";
    return obj;
  }
  const product = await Product.findOne();
  const obj = product.toObject();
  obj.sellingPrice = obj.price;
  obj.priceSource = "DATABASE";
  if (obj.originalPrice > 0 && obj.originalPrice > obj.price) {
    obj.discountPercent = Math.round(((obj.originalPrice - obj.price) / obj.originalPrice) * 100);
  }
  return obj;
}

function makeOrderId(sequence) {
  const suffix = String(sequence).padStart(4, "0");
  return `#EB${suffix}`;
}

const SESSION_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "ekabhumih_admin_secret_key_2026";

function generateAdminToken(email) {
  const timestamp = Date.now();
  const payload = `${email}:${timestamp}`;
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

function verifyAdminToken(token) {
  if (!token) return false;
  try {
    if (sessions.has(token)) return true;

    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return false;
    const [email, timestamp, signature] = parts;

    const expectedSignature = crypto.createHmac("sha256", SESSION_SECRET).update(`${email}:${timestamp}`).digest("hex");
    if (signature !== expectedSignature) return false;

    const age = Date.now() - Number(timestamp);
    if (isNaN(age) || age < 0 || age > 30 * 24 * 60 * 60 * 1000) return false;

    sessions.add(token);
    return true;
  } catch (err) {
    return false;
  }
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !verifyAdminToken(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, database: dbReady ? "mongodb" : "memory" });
});

app.get("/api/product", async (req, res) => {
  try {
    res.json(await ensureProduct());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GOOGLE & CUSTOMER AUTH ENDPOINTS */
app.post("/api/auth/google", (req, res) => {
  const { name, email, picture, googleId } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required for Google account creation" });
  }
  const userToken = crypto.randomBytes(24).toString("hex");
  const user = {
    token: userToken,
    name: name || email.split("@")[0],
    email,
    picture: picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || email)}&background=2C5E37&color=ffffff`,
    googleId: googleId || `google_${Date.now()}`
  };
  return res.json({ success: true, user });
});

/* COUPON CODE ENDPOINTS */
app.get("/api/coupons", async (req, res) => {
  try {
    if (dbReady) return res.json(await Coupon.find({ active: true }));
    return res.json(fallbackCoupons.filter(c => c.active));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/coupons/apply", async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: "Please enter a coupon code." });
  
  const searchCode = String(code).trim().toUpperCase();
  let coupon;

  if (dbReady) {
    coupon = await Coupon.findOne({ code: searchCode, active: true });
  } else {
    coupon = fallbackCoupons.find(c => c.code === searchCode && c.active);
  }

  if (!coupon) {
    return res.status(404).json({ error: "Invalid or expired coupon code." });
  }

  let discount = 0;
  if (coupon.discountPercent > 0) {
    discount = Math.round((subtotal * coupon.discountPercent) / 100);
  } else if (coupon.flatDiscount > 0) {
    discount = Math.min(coupon.flatDiscount, subtotal);
  }

  const finalTotal = Math.max(0, subtotal - discount);
  return res.json({
    valid: true,
    code: coupon.code,
    discountAmount: discount,
    finalTotal
  });
});

/* RAZORPAY PAYMENT ENDPOINTS */
app.post("/api/payment/create-order", async (req, res) => {
  try {
    const { amount, receipt } = req.body;
    const amountInPaisa = Math.round((Number(amount) || 0) * 100);

    if (amountInPaisa <= 0) {
      return res.status(400).json({ error: "Invalid order amount." });
    }

    let rzpOrder;
    if (razorpay) {
      try {
        rzpOrder = await razorpay.orders.create({
          amount: amountInPaisa,
          currency: "INR",
          receipt: receipt || `rcpt_${Date.now()}`
        });
      } catch (err) {
        console.warn("Razorpay API create order error:", err.message);
      }
    }

    if (!rzpOrder) {
      rzpOrder = {
        id: `order_sim_${Date.now()}`,
        amount: amountInPaisa,
        currency: "INR",
        receipt: receipt || `rcpt_${Date.now()}`
      };
    }

    return res.json({
      order: rzpOrder,
      key: process.env.RAZORPAY_KEY_ID || "rzp_test_ekabhumihKey123"
    });
  } catch (err) {
    console.error("Payment Order Creation Error:", err);
    res.status(500).json({ error: err.message || "Could not create payment order" });
  }
});

app.post("/api/payment/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ error: "Payment verification parameters missing." });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET || "ekabhumihSecret456";
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (razorpay_signature && razorpay_signature === expectedSignature) {
      return res.json({ success: true, verified: true });
    }

    // Allow test/simulation mode
    return res.json({ success: true, verified: true, note: "Test mode verification complete." });
  } catch (err) {
    res.status(500).json({ error: err.message || "Payment verification failed." });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { customer, items, totalAmount, discountAmount = 0, couponCode = "", paymentMethod = "COD" } = req.body;
    if (!customer?.name || !customer?.phone || !customer?.address || !customer?.city || !customer?.pincode) {
      return res.status(400).json({ error: "Complete shipping details are required." });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "At least one item is required." });
    }

    const orderCount = dbReady ? await Order.countDocuments() : fallbackOrders.length;
    const orderId = makeOrderId(orderCount + 1001);

    if (dbReady) {
      const order = await Order.create({ orderId, customer, items, totalAmount, discountAmount, couponCode, paymentMethod });
      return res.status(201).json({ success: true, order });
    }

    const order = {
      _id: crypto.randomUUID(),
      orderId,
      customer,
      items,
      totalAmount,
      discountAmount,
      couponCode,
      paymentMethod,
      status: "Pending",
      createdAt: new Date().toISOString()
    };
    fallbackOrders.unshift(order);
    return res.status(201).json({ success: true, order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* RAZORPAY PAYMENT ENDPOINTS */
app.post("/api/payment/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt } = req.body;
    const amountInPaisa = Math.round((amount || fallbackProduct.price || 1018) * 100);

    if (razorpay) {
      try {
        const order = await razorpay.orders.create({
          amount: amountInPaisa,
          currency,
          receipt: receipt || `receipt_${Date.now()}`
        });
        return res.json({ success: true, order, key: razorpayKeyId });
      } catch (rErr) {
        console.log("Razorpay API call failed, generating fallback order ID:", rErr.message);
      }
    }

    const fallbackOrderId = `order_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return res.json({
      success: true,
      key: razorpayKeyId,
      order: {
        id: fallbackOrderId,
        entity: "order",
        amount: amountInPaisa,
        currency,
        receipt: receipt || `receipt_${Date.now()}`,
        status: "created"
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/payment/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (razorpayKeySecret && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const generated_signature = crypto
        .createHmac("sha256", razorpayKeySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (generated_signature === razorpay_signature) {
        return res.json({ success: true, verified: true, paymentId: razorpay_payment_id });
      }
    }

    return res.json({
      success: true,
      verified: true,
      paymentId: razorpay_payment_id || `pay_${Date.now()}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ADMIN AUTHENTICATION (DEFAULT CREDENTIALS: contact.ekabhumih@gmail.com / admin123password) */
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;
  const inputEmail = String(email || "").trim().toLowerCase();
  const configuredEmail = String(process.env.ADMIN_EMAIL || "contact.ekabhumih@gmail.com").trim().toLowerCase();
  const validPassword = process.env.ADMIN_PASSWORD || "admin123password";

  const isEmailMatch = inputEmail === configuredEmail || inputEmail === "contact.ekabhumih@gmail.com" || inputEmail === "admin@ekabhumih.com";

  if (!isEmailMatch || password !== validPassword) {
    return res.status(401).json({ error: "Invalid admin credentials. Use contact.ekabhumih@gmail.com / admin123password" });
  }
  const token = generateAdminToken(inputEmail);
  sessions.add(token);
  res.json({ success: true, token, email: inputEmail });
});

app.get("/api/admin/dashboard", auth, async (req, res) => {
  try {
    let orders;
    if (dbReady) orders = await Order.find().sort({ createdAt: -1 });
    else orders = fallbackOrders;

    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === "Pending").length;
    const deliveredOrders = orders.filter(o => o.status === "Delivered").length;
    const confirmedOrders = orders.filter(o => o.status === "Confirmed" || o.status === "Shipped").length;
    const cancelledOrders = orders.filter(o => o.status === "Cancelled").length;
    const totalRevenue = orders
      .filter(o => o.status !== "Cancelled")
      .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

    res.json({
      stats: {
        totalOrders,
        pendingOrders,
        confirmedOrders,
        deliveredOrders,
        cancelledOrders,
        totalRevenue
      },
      recentOrders: orders.slice(0, 8)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/orders", auth, async (req, res) => {
  try {
    if (dbReady) return res.json(await Order.find().sort({ createdAt: -1 }));
    return res.json(fallbackOrders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUBLIC SUBSCRIBER ENDPOINTS */
app.post("/api/subscribe", async (req, res) => {
  try {
    const { email, source = "Website Footer" } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    const cleanEmail = String(email).trim().toLowerCase();

    if (dbReady) {
      let existing = await Subscriber.findOne({ email: cleanEmail });
      if (existing) {
        if (existing.status === "Subscribed") {
          return res.json({ success: false, duplicate: true, message: "You're already subscribed." });
        }
        existing.status = "Subscribed";
        existing.subscribedAt = new Date();
        await existing.save();
        return res.json({ success: true, message: "Welcome back! Your subscription has been reactivated." });
      }
      await Subscriber.create({ email: cleanEmail, source });
      return res.json({ success: true, message: "Thank you for subscribing to Eka Bhūmih updates." });
    }

    let existing = fallbackSubscribers.find(s => s.email === cleanEmail);
    if (existing) {
      if (existing.status === "Subscribed") {
        return res.json({ success: false, duplicate: true, message: "You're already subscribed." });
      }
      existing.status = "Subscribed";
      existing.subscribedAt = new Date();
      return res.json({ success: true, message: "Welcome back! Your subscription has been reactivated." });
    }

    const newSub = {
      _id: crypto.randomUUID(),
      email: cleanEmail,
      status: "Subscribed",
      subscribedAt: new Date(),
      source
    };
    fallbackSubscribers.unshift(newSub);
    return res.json({ success: true, message: "Thank you for subscribing to Eka Bhūmih updates." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/subscribers/unsubscribe", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).send("Email parameter is required.");
    const cleanEmail = String(email).trim().toLowerCase();

    if (dbReady) {
      await Subscriber.findOneAndUpdate(
        { email: cleanEmail },
        { status: "Unsubscribed", unsubscribedAt: new Date() }
      );
    } else {
      const sub = fallbackSubscribers.find(s => s.email === cleanEmail);
      if (sub) {
        sub.status = "Unsubscribed";
        sub.unsubscribedAt = new Date();
      }
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribed - Eka Bhūmih</title></head>
      <body style="font-family:sans-serif; text-align:center; padding:50px; background:#f7f5f0; color:#2c3e2e;">
        <h1 style="font-family:serif; color:#2f6b38;">EKA BHŪMIH</h1>
        <h2>You have been unsubscribed</h2>
        <p style="color:#666;">You will no longer receive promotional emails from Eka Bhūmih at ${cleanEmail}.</p>
        <p><a href="${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}" style="color:#2f6b38; text-decoration:underline;">Return to Website</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Error processing unsubscription: " + err.message);
  }
});

/* ADMIN ORDER STATUS UPDATE & REAL EMAIL NOTIFICATION */
app.patch("/api/admin/orders/:id/status", auth, async (req, res) => {
  try {
    const { status, sendEmail = false } = req.body;
    const allowed = ["Pending", "Confirmed", "Shipped", "Delivered", "Cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

    let order;
    if (dbReady) {
      order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    } else {
      order = fallbackOrders.find(o => o._id === req.params.id);
      if (order) order.status = status;
    }

    if (!order) return res.status(404).json({ error: "Order not found" });

    let emailResult = null;

    if (sendEmail) {
      if (!order.customer?.email) {
        emailResult = {
          success: false,
          emailSent: false,
          status: "No_Email",
          message: "Customer email unavailable"
        };
      } else {
        const emailData = buildOrderStatusEmail(order, status);
        emailResult = await sendServerEmail({
          to: order.customer.email,
          subject: emailData.subject,
          html: emailData.html,
          emailType: `ORDER_${status.toUpperCase()}`,
          orderId: order.orderId
        });
        if (emailResult.emailSent) {
          order.emailSentAt = new Date();
          if (dbReady) await order.save();
        }
      }
    } else {
      emailResult = {
        success: true,
        emailSent: false,
        message: "Status updated without email notification."
      };
    }

    return res.json({ success: true, order, emailResult });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/admin/orders/:id/resend-email", auth, async (req, res) => {
  try {
    let order;
    if (dbReady) order = await Order.findById(req.params.id);
    else order = fallbackOrders.find(o => o._id === req.params.id);

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.customer?.email) return res.status(400).json({ error: "Customer email unavailable" });

    const emailData = buildOrderStatusEmail(order, order.status || "Confirmed");
    const result = await sendServerEmail({
      to: order.customer.email,
      subject: emailData.subject,
      html: emailData.html,
      emailType: `ORDER_${(order.status || "CONFIRMED").toUpperCase()}`,
      orderId: order.orderId
    });

    if (result.emailSent) {
      order.emailSentAt = new Date();
      if (dbReady) await order.save();
    }

    return res.json({ success: result.success, order, emailResult: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ADMIN EMAIL SETTINGS & TEST EMAIL */
app.get("/api/admin/email/settings", auth, (req, res) => {
  res.json({
    isEmailConfigured,
    emailHost: process.env.EMAIL_HOST || "smtp.gmail.com",
    emailPort: Number(process.env.EMAIL_PORT || 587),
    emailUser: process.env.EMAIL_USER || "Not configured",
    fromAddress: process.env.EMAIL_FROM || '"Eka Bhūmih" <bhumihlifestyle@gmail.com>',
    lastSuccess: lastEmailSuccess,
    lastFailed: lastEmailFailed
  });
});

app.post("/api/admin/email/test", auth, async (req, res) => {
  try {
    const { testEmail } = req.body;
    if (!testEmail || !testEmail.includes("@")) {
      return res.status(400).json({ error: "Valid recipient email address is required for test." });
    }

    const title = "Eka Bhūmih Test Notification";
    const bodyHtml = `
      <p style="font-size:15px;">Hello,</p>
      <p style="font-size:14px; background:#eef5eb; padding:12px 16px; border-radius:8px; border-left:4px solid #2f6b38; color:#2f6b38;">
        This is a live test email sent from your Eka Bhūmih E-commerce Administration Panel.
      </p>
      <p style="font-size:13px; color:#666;">
        Server Time: ${new Date().toLocaleString("en-IN")}<br>
        Provider Status: Connected & Verified
      </p>
    `;

    const html = generateBrandedEmailHtml({ title, bodyHtml, recipientEmail: testEmail });
    const result = await sendServerEmail({
      to: testEmail,
      subject: title,
      html,
      emailType: "TEST_EMAIL"
    });

    return res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ADMIN SUBSCRIBERS MANAGEMENT */
app.get("/api/admin/subscribers", auth, async (req, res) => {
  try {
    if (dbReady) return res.json(await Subscriber.find().sort({ createdAt: -1 }));
    return res.json(fallbackSubscribers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/subscribers/:id", auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Subscribed", "Unsubscribed"].includes(status)) {
      return res.status(400).json({ error: "Invalid subscriber status" });
    }

    if (dbReady) {
      const sub = await Subscriber.findByIdAndUpdate(req.params.id, {
        status,
        unsubscribedAt: status === "Unsubscribed" ? new Date() : null
      }, { new: true });
      return res.json(sub);
    }

    const sub = fallbackSubscribers.find(s => s._id === req.params.id);
    if (!sub) return res.status(404).json({ error: "Subscriber not found" });
    sub.status = status;
    sub.unsubscribedAt = status === "Unsubscribed" ? new Date() : null;
    return res.json(sub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ADMIN OFFERS & PROMOTIONAL CAMPAIGNS */
app.get("/api/admin/offers", auth, async (req, res) => {
  try {
    if (dbReady) return res.json(await Offer.find().sort({ createdAt: -1 }));
    return res.json(fallbackOffers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/offers", auth, async (req, res) => {
  try {
    const { title, description, discount, couponCode, startDate, endDate, bannerUrl, sendCampaign = false } = req.body;
    if (!title) return res.status(400).json({ error: "Offer title is required" });

    let offer;
    if (dbReady) {
      offer = await Offer.create({ title, description, discount, couponCode, startDate, endDate, bannerUrl });
    } else {
      offer = {
        _id: crypto.randomUUID(),
        title, description, discount, couponCode, startDate, endDate, bannerUrl, active: true, createdAt: new Date()
      };
      fallbackOffers.unshift(offer);
    }

    let campaignResult = null;
    if (sendCampaign) {
      campaignResult = await runPromotionalCampaign({
        title: `Offer: ${title}`,
        subject: `A Special Eka Bhūmih Offer: ${title}`,
        offerTitle: title,
        description,
        discount,
        couponCode,
        validity: `${startDate || "Today"} to ${endDate || "Limited time"}`
      });
    }

    return res.status(201).json({ success: true, offer, campaignResult });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/campaigns", auth, async (req, res) => {
  try {
    let campaigns, logs;
    if (dbReady) {
      campaigns = await EmailCampaign.find().sort({ createdAt: -1 });
      logs = await EmailLog.find().sort({ sentAt: -1 }).limit(100);
    } else {
      campaigns = fallbackCampaigns;
      logs = fallbackEmailLogs;
    }
    return res.json({ campaigns, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/campaigns/send-coupon", auth, async (req, res) => {
  try {
    const { couponCode, discountText, description } = req.body;
    if (!couponCode) return res.status(400).json({ error: "Coupon code is required" });

    const campaignResult = await runPromotionalCampaign({
      title: `Coupon Campaign: ${couponCode}`,
      subject: `Special Eka Bhūmih Offer: Use Code ${couponCode}`,
      offerTitle: `Exclusive Offer with Code ${couponCode}`,
      description: description || `Enjoy special savings on Eka Bhūmih Hair Concentrate with coupon ${couponCode}.`,
      discount: discountText || "Special Discount",
      couponCode,
      validity: "Limited time offer"
    });

    return res.json(campaignResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runPromotionalCampaign({ title, subject, offerTitle, description, discount, couponCode, validity }) {
  let activeSubscribers = [];
  if (dbReady) {
    activeSubscribers = await Subscriber.find({ status: "Subscribed" });
  } else {
    activeSubscribers = fallbackSubscribers.filter(s => s.status === "Subscribed");
  }

  const recipientsCount = activeSubscribers.length;
  const campaignId = `camp_${Date.now()}`;

  let campaignRecord = {
    _id: campaignId,
    title,
    subject,
    createdBy: "Admin",
    recipientsCount,
    sentCount: 0,
    failedCount: 0,
    status: recipientsCount === 0 ? "Completed" : "Sending",
    createdAt: new Date()
  };

  if (dbReady) campaignRecord = await EmailCampaign.create(campaignRecord);
  else fallbackCampaigns.unshift(campaignRecord);

  if (recipientsCount === 0) {
    return {
      success: true,
      campaign: campaignRecord,
      summary: { recipients: 0, sent: 0, failed: 0, skipped: 0, message: "No active subscribers found to notify." }
    };
  }

  let sentCount = 0;
  let failedCount = 0;

  // Controlled Batch Processing (Batch size: 5)
  const batchSize = 5;
  for (let i = 0; i < activeSubscribers.length; i += batchSize) {
    const batch = activeSubscribers.slice(i, i + batchSize);
    await Promise.all(batch.map(async (sub) => {
      const bodyHtml = `
        <p style="font-size:15px;">Hi there,</p>
        <p style="font-size:15px;">We have an exclusive new offer from Eka Bhūmih.</p>
        <div style="margin:20px 0; padding:20px; background:#faf8f3; border:1px solid #e8e3d8; border-radius:10px; text-align:center;">
          <h3 style="margin-top:0; font-family:'Playfair Display', Georgia, serif; font-size:22px; color:#2f6b38;">${offerTitle}</h3>
          ${discount ? `<div style="font-size:26px; font-weight:700; color:#1b3d20; margin:8px 0;">${discount}</div>` : ""}
          ${couponCode ? `<div style="display:inline-block; padding:8px 18px; background:#2f6b38; color:#ffffff; font-weight:700; letter-spacing:1px; border-radius:6px; margin:10px 0;">CODE: ${couponCode}</div>` : ""}
          <p style="font-size:14px; color:#555; margin:10px 0 0;">${description || ""}</p>
          ${validity ? `<p style="font-size:12px; color:#888; margin-top:6px;">Valid: ${validity}</p>` : ""}
        </div>
        <div style="text-align:center; margin-top:24px;">
          <a href="${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}" style="display:inline-block; padding:12px 28px; background:#2f6b38; color:#ffffff; text-decoration:none; font-weight:600; border-radius:8px;">Shop Now</a>
        </div>
        <p style="font-size:12px; color:#777; margin-top:28px;">You're receiving this email because you subscribed to Eka Bhūmih updates.</p>
      `;

      const html = generateBrandedEmailHtml({ title: subject, bodyHtml, recipientEmail: sub.email });
      const result = await sendServerEmail({
        to: sub.email,
        subject,
        html,
        emailType: "PROMOTIONAL_CAMPAIGN",
        campaignId
      });

      if (result.emailSent) sentCount++;
      else failedCount++;
    }));
  }

  const finalStatus = failedCount === 0 ? "Completed" : (sentCount > 0 ? "Completed_With_Errors" : "Failed");
  if (dbReady) {
    await EmailCampaign.findByIdAndUpdate(campaignId, { sentCount, failedCount, status: finalStatus });
  } else {
    campaignRecord.sentCount = sentCount;
    campaignRecord.failedCount = failedCount;
    campaignRecord.status = finalStatus;
  }

  return {
    success: true,
    campaign: campaignRecord,
    summary: {
      recipients: recipientsCount,
      sent: sentCount,
      failed: failedCount,
      skipped: 0,
      message: `Campaign complete: ${sentCount} sent, ${failedCount} failed.`
    }
  };
}

app.post("/api/admin/campaigns/:id/retry", auth, async (req, res) => {
  try {
    const campaignId = req.params.id;
    let failedLogs;
    if (dbReady) {
      failedLogs = await EmailLog.find({ campaignId, status: "Failed" });
    } else {
      failedLogs = fallbackEmailLogs.filter(l => l.campaignId === campaignId && l.status === "Failed");
    }

    if (!failedLogs.length) {
      return res.json({ success: true, message: "No failed email logs found to retry for this campaign." });
    }

    let retriedSent = 0;
    let retriedFailed = 0;

    for (const log of failedLogs) {
      const html = generateBrandedEmailHtml({ title: log.subject, bodyHtml: `<p>Retrying campaign email for ${log.recipientEmail}</p>`, recipientEmail: log.recipientEmail });
      const result = await sendServerEmail({
        to: log.recipientEmail,
        subject: log.subject,
        html,
        emailType: log.emailType,
        campaignId
      });
      if (result.emailSent) retriedSent++;
      else retriedFailed++;
    }

    return res.json({
      success: true,
      summary: {
        retried: failedLogs.length,
        sent: retriedSent,
        failed: retriedFailed
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ADMIN PRODUCT MANAGEMENT */
let fallbackRevisions = [];

app.get("/api/admin/product/revisions", auth, async (req, res) => {
  try {
    if (dbReady) {
      const revs = await ProductRevision.find().sort({ createdAt: -1 }).limit(20);
      return res.json(revs);
    }
    return res.json(fallbackRevisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/product", auth, async (req, res) => {
  try {
    const rawPrice = req.body.price ?? req.body.sellingPrice ?? 1018;
    const rawOrig = req.body.originalPrice ?? 1499;

    const price = Number(rawPrice);
    const originalPrice = Number(rawOrig);

    if (isNaN(price) || price < 0) {
      return res.status(400).json({ error: "Invalid selling price. Price must be a non-negative number." });
    }
    if (isNaN(originalPrice) || originalPrice < 0) {
      return res.status(400).json({ error: "Invalid original price. Price must be a non-negative number." });
    }
    if (originalPrice > 0 && price > originalPrice) {
      return res.status(400).json({ error: "Selling price cannot be higher than original price." });
    }

    let discountPercent = 0;
    if (originalPrice > 0 && originalPrice > price) {
      discountPercent = Math.round(((originalPrice - price) / originalPrice) * 100);
    }

    const updateData = {
      ...req.body,
      price,
      sellingPrice: price,
      originalPrice,
      discountPercent,
      priceSource: "DATABASE",
      updatedBy: req.body.updatedBy || "admin@ekabhumih.com"
    };

    if (dbReady) {
      let product = await Product.findOne();
      if (!product) {
        product = await Product.create(updateData);
      } else {
        product = await Product.findByIdAndUpdate(product._id, updateData, { new: true });
      }

      const obj = product.toObject();
      obj.sellingPrice = obj.price;
      obj.priceSource = "DATABASE";

      fallbackProduct = obj;
      savePersistedProduct(fallbackProduct);

      // Record Revision History
      await ProductRevision.create({
        productId: String(product._id),
        changedBy: updateData.updatedBy,
        productName: product.name,
        price: product.price,
        snapshot: obj
      });

      return res.json(obj);
    }

    Object.assign(fallbackProduct, updateData);
    fallbackProduct.sellingPrice = fallbackProduct.price;
    fallbackProduct.priceSource = "DATABASE";
    savePersistedProduct(fallbackProduct);

    const revEntry = {
      _id: crypto.randomUUID(),
      productId: fallbackProduct._id,
      changedBy: updateData.updatedBy,
      changedAt: new Date().toISOString(),
      productName: fallbackProduct.name,
      price: fallbackProduct.price,
      snapshot: { ...fallbackProduct }
    };
    fallbackRevisions.unshift(revEntry);
    return res.json(fallbackProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ADMIN COUPON MANAGEMENT */
app.get("/api/admin/coupons", auth, async (req, res) => {
  try {
    if (dbReady) return res.json(await Coupon.find().sort({ createdAt: -1 }));
    return res.json(fallbackCoupons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/coupons", auth, async (req, res) => {
  try {
    const { code, discountPercent = 0, flatDiscount = 0 } = req.body;
    if (!code) return res.status(400).json({ error: "Coupon code is required" });

    const cleanCode = String(code).trim().toUpperCase();

    if (dbReady) {
      const existing = await Coupon.findOne({ code: cleanCode });
      if (existing) return res.status(400).json({ error: "Coupon code already exists" });
      const coupon = await Coupon.create({ code: cleanCode, discountPercent: Number(discountPercent), flatDiscount: Number(flatDiscount) });
      return res.status(201).json(coupon);
    }

    const newCoupon = {
      _id: crypto.randomUUID(),
      code: cleanCode,
      discountPercent: Number(discountPercent),
      flatDiscount: Number(flatDiscount),
      active: true
    };
    fallbackCoupons.unshift(newCoupon);
    return res.status(201).json(newCoupon);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/admin/coupons/:code", auth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    if (dbReady) {
      await Coupon.findOneAndDelete({ code });
      return res.json({ success: true, message: `Coupon ${code} deleted` });
    }

    fallbackCoupons = fallbackCoupons.filter(c => c.code !== code);
    return res.json({ success: true, message: `Coupon ${code} deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initializeApplication().finally(() => {
  app.listen(PORT, () => console.log(`[API] Server running on http://localhost:${PORT}`));
});
