import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import connectDB from './config/db';
import { errorHandler } from './middleware/errorHandler';
import { Site } from './models';
import authRoutes from './routes/auth.routes';
import siteRoutes from './routes/site.routes';
import adminRoutes from './routes/admin.routes';

const app = express();
const PORT = process.env.PORT || 5000;
const STORAGE_PATH = path.join(__dirname, '../storage/sites');

fs.mkdirSync(STORAGE_PATH, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/admin', adminRoutes);

// Serve deployed sites — req.path gives the sub-path after /sites/:siteId
app.use('/sites/:siteId', async (req: Request, res: Response) => {
  const siteId = req.params.siteId as string;

  // Look up by slug (user-chosen URL) — falls back to siteId if slug was never customized
  const site = await Site.findOne({ $or: [{ slug: siteId }, { siteId }], status: 'active' });
  if (!site) {
    res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Site Not Found — Chasqr</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: #ffffff;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
    .container { max-width: 420px; width: 100%; }
    .icon {
      width: 80px; height: 80px;
      background: #eff6ff;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 2rem;
    }
    .icon svg { width: 36px; height: 36px; color: #2563eb; }
    .code {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 7rem;
      line-height: 1;
      color: #e2e8f0;
      letter-spacing: 0.04em;
      margin-bottom: 0.5rem;
    }
    h1 {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 1.8rem;
      color: #0f172a;
      letter-spacing: 0.04em;
      margin-bottom: 0.75rem;
    }
    p {
      font-size: 0.9rem;
      color: #64748b;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .badge {
      display: inline-block;
      background: #f1f5f9;
      color: #64748b;
      font-size: 0.75rem;
      font-family: monospace;
      padding: 0.3rem 0.75rem;
      border-radius: 99px;
      margin-bottom: 2rem;
      border: 1px solid #e2e8f0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
    </div>
    <div class="code">404</div>
    <h1>Site Not Found</h1>
    <p>This site doesn't exist or has been taken offline by its owner.</p>
    <div class="badge">${siteId}</div>
  </div>
</body>
</html>`);
    return;
  }

  // Use site.siteId (DB field) for file paths — NOT the URL param which may be a custom slug
  const storageSiteId = site.siteId;
  Site.updateOne({ _id: site._id }, { $inc: { visits: 1 } }).exec();

  const subPath = req.path === '/' ? 'index.html' : req.path;
  const safePath = path.normalize(subPath).replace(/^(\.\.[\\/])+/, '');
  const filePath = path.join(STORAGE_PATH, storageSiteId, safePath);

  if (!fs.existsSync(filePath)) {
    const indexPath = path.join(STORAGE_PATH, storageSiteId, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('<h1>404 — File not found</h1>');
    }
    return;
  }

  res.sendFile(filePath);
});

app.use(errorHandler);

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

start().catch(console.error);
