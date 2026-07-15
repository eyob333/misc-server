import 'dotenv/config'; // Automatically parses and loads .env variables
import express from 'express';
import postgres from 'postgres';
import nodemailer from 'nodemailer';

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Validation check for environment variables
if (!process.env.DATABASE_URL) {
  console.error("❌ Error: DATABASE_URL is missing in your .env file!");
  process.exit(1);
}

// 2. Initialize Neon DB connection pool (postgres.js handles pool management automatically)
const sql = postgres(process.env.DATABASE_URL, { 
  ssl: 'require',
  max: 10 // Maximum parallel database connections
});

// 3. Initialize Nodemailer Transporter (Reused across mail requests)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for port 465, false for port 587 (uses STARTTLS)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Middleware to parse incoming JSON payloads
app.use(express.json());

/**
 * Endpoint 1: Server and DB Health check
 */
app.get('/health', async (req, res) => {
  try {
    const [dbResult] = await sql`SELECT now() as db_time;`;
    res.json({
      status: 'healthy',
      database: 'connected',
      dbTime: dbResult.db_time
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

/**
 * Endpoint 2: Send Email (Send to yourself or others)
 */
app.post('/api/send-email', async (req, res) => {
  const { to, subject, text, html } = req.body;

  // Basic validation
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, and either text or html content.' });
  }

  const mailOptions = {
    from: `"My Server App" <${process.env.SMTP_USER}>`, // Sender identity
    to: to,                                             // Receiver's address (string or array of addresses)
    subject: subject,                                   // Email Subject
    text: text,                                         // Plaintext alternative body
    html: html                                          // HTML body
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Email successfully sent: ${info.messageId}`);
    res.json({ 
      success: true, 
      messageId: info.messageId, 
      info: 'Email sent successfully!' 
    });
  } catch (error) {
    console.error('❌ Nodemailer failed to send email:', error);
    res.status(500).json({ error: 'Failed to dispatch email.', details: error.message });
  }
});

// 4. Start Server
const server = app.listen(PORT, () => {
  console.log(`🚀 Express server running on http://localhost:${PORT}`);
  console.log(`🔗 Connected to Neon Database`);
});

/**
 * Graceful Shutdown Protocol
 * Drains DB connection pools and closes open servers securely when stopping application.
 */
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(async () => {
    console.log('Express HTTP server closed.');
    await sql.end(); // Clean up DB pools
    console.log('Postgres connection pool drained. Goodbye!');
    process.exit(0);
  });
});