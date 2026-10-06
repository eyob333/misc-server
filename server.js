import 'dotenv/config';
import express from 'express';
import postgres from 'postgres';
import nodemailer from 'nodemailer';
import cors from 'cors';
import logger from './logger.js';

const app = express();
const PORT = process.env.PORT || 5000;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'x@icloud.com';

if (!process.env.DATABASE_URL) {
  logger.error("DATABASE_URL is missing in your .env file!");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { 
  ssl: 'require',
  max: 10 
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  logger.http(`Incoming ${req.method} request to ${req.url}`);
  next();
});

app.get('/health', async (req, res) => {
  try {
    const [dbResult] = await sql`SELECT now() as db_time;`;
    logger.info('Health check passed successfully.');
    res.json({
      status: 'healthy',
      database: 'connected',
      dbTime: dbResult.db_time
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

app.post('/api/msc', async (req, res) => {
  const { name, sender, content } = req.body;

  if (!name || !sender) {
    logger.warn('Validation failed: Missing name or sender in /api/msc request.');
    return res.status(400).json({ error: 'Missing required fields: name and sender are required.' });
  }

  try {
    const [post] = await sql`
      INSERT INTO msc (name, sender, content)
      VALUES (${name}, ${sender}, ${content || ''})
      RETURNING id, name, sender, content, created_at;
    `;

    const isoUtcTimestamp = new Date(post.created_at).toISOString();
    const localTimestamp = new Date(post.created_at).toLocaleString('en-US', {
      timeZone: 'Africa/Addis_Ababa',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    logger.info(`Saved post #${post.id} from ${sender} at local time ${localTimestamp}`);

    const mailOptions = {
      from: `"Green Notice " <${process.env.SMTP_USER}>`,
      to: NOTIFY_EMAIL,
      subject: `New Portfolio Post`,
      text: `New post received!\n\nLocal Time: ${localTimestamp}\nUTC Time: ${isoUtcTimestamp}\n\nName: ${name}\nSender: ${sender}\n\nContent:\n${content || '(No content provided)'}`,
      html: `

        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Adress:</strong> ${sender}</p>
        <hr />
        <p><strong>Content:</strong></p>
        <p>${(content || '(No content provided)').replace(/\n/g, '<br>')}</p>
        <p><strong> ${localTimestamp}</strong></p>
      `
    };

    const mailInfo = await transporter.sendMail(mailOptions);
    logger.info(`Notification email sent to ${NOTIFY_EMAIL}: ${mailInfo.messageId}`);

    res.status(201).json({
      success: true,
      message: 'Post saved to msc table and notification email sent successfully.',
      data: {
        id: post.id,
        name: post.name,
        sender: post.sender,
        content: post.content,
        created_at_utc: isoUtcTimestamp,
        created_at_local: localTimestamp
      }
    });

  } catch (error) {
    logger.error('Failed to process MSC post:', error);
    res.status(500).json({ 
      error: 'Failed to process request.', 
      details: error.message 
    });
  }
});

const server = app.listen(PORT, () => {
  logger.info(`Express server running on http://localhost:${PORT}`);
  logger.info('Connected to Neon Database');
});

process.on('SIGINT', () => {
  logger.warn('Shutting down server...');
  server.close(async () => {
    logger.info('Express HTTP server closed.');
    await sql.end();
    logger.info('Postgres connection pool drained. Goodbye!');
    process.exit(0);
  });
});