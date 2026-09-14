import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import apiRoutes from './routes/index.route.js';
import errorHandler from './middleware/error.middleware.js';

dotenv.config();

const app = express();

// Security and utility middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [];

const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow mobile apps, curl, Postman (which do not send an Origin header)
    if (!origin) return callback(null, true);

    // 2. Allow localhost, 127.0.0.1, and private LAN IP ranges on any development port
    const isLocalOrLan = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);

    if (isLocalOrLan || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Multi-Tier E-Commerce & POS API',
    module_system: 'ES Modules',
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api', apiRoutes);

// Catch 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route '${req.method} ${req.originalUrl}' not found on this server.`
  });
});

// Centralized error handler
app.use(errorHandler);

export default app;
