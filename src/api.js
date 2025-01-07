import express from 'express';
import cors from 'cors';
import SnapTikClient from './index.js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';

// Initialize
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config();

// Performance optimizations
const app = express();
const port = process.env.PORT || 3000;
const ASSEMBLY_API_URL = 'https://api.assemblyai.com/v2';

// Security and CORS configuration
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Add these headers to all responses
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    next();
});

// In-memory cache with expiration
const cache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Rate limiting
const RATE_LIMIT = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 30; // 30 requests per minute

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting middleware
function rateLimiter(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    
    if (RATE_LIMIT.has(ip)) {
        const requests = RATE_LIMIT.get(ip).filter(time => now - time < RATE_LIMIT_WINDOW);
        if (requests.length >= MAX_REQUESTS) {
            return res.status(429).json({ 
                success: false, 
                error: 'Too many requests. Please try again later.' 
            });
        }
        requests.push(now);
        RATE_LIMIT.set(ip, requests);
    } else {
        RATE_LIMIT.set(ip, [now]);
    }
    
    next();
}

// Enhanced logging function
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = data 
        ? `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}`
        : `[${timestamp}] ${message}`;
    console.log(logMessage);
}

async function getTranscription(tiktokUrl) {
    try {
        log('Starting transcription process for:', { tiktokUrl });

        // Check cache
        if (cache.has(tiktokUrl)) {
            const { transcription, timestamp } = cache.get(tiktokUrl);
            if (Date.now() - timestamp < CACHE_DURATION) {
                log('Cache hit! Returning cached transcription');
                return transcription;
            }
            log('Cache expired, fetching fresh transcription');
            cache.delete(tiktokUrl);
        }

        log('Creating SnapTikClient...');
        const client = new SnapTikClient();
        
        log('Processing TikTok URL...');
        const result = await client.process(tiktokUrl);
        log('SnapTik result:', result);
        
        if (!result.type === 'video' || !result.data.sources || !result.data.sources.length) {
            throw new Error('No video source found');
        }

        const audioUrl = result.data.sources[0].url;
        log('Got audio URL:', { audioUrl });

        log('Starting AssemblyAI transcription...');
        const transcribeResponse = await fetch(`${ASSEMBLY_API_URL}/transcript`, {
            method: 'POST',
            headers: {
                'authorization': process.env.ASSEMBLYAI_API_KEY,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ 
                audio_url: audioUrl,
                speed_boost: true,
                language_detection: true
            })
        });
        
        const transcribeJson = await transcribeResponse.json();
        log('AssemblyAI initial response:', transcribeJson);

        const { id: transcriptId, error } = transcribeJson;
        if (error) throw new Error(`Failed to start transcription: ${error}`);

        log('Got transcript ID:', { transcriptId });
        log('Waiting for transcription completion...');

        // Polling with logs
        let attempts = 0;
        const maxAttempts = 15;
        let waitTime = 1000;

        while (attempts < maxAttempts) {
            attempts++;
            log(`Polling attempt ${attempts}/${maxAttempts}`);

            const response = await fetch(`${ASSEMBLY_API_URL}/transcript/${transcriptId}`, {
                headers: {
                    'authorization': process.env.ASSEMBLYAI_API_KEY,
                },
            });
            const result = await response.json();
            log('Poll status:', { status: result.status });

            if (result.status === 'completed') {
                log('Transcription completed successfully!');
                cache.set(tiktokUrl, {
                    transcription: result.text,
                    timestamp: Date.now()
                });
                return result.text;
            } else if (result.status === 'error') {
                throw new Error(`Transcription failed: ${result.error}`);
            }
            
            log(`Waiting ${waitTime}ms before next poll`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            waitTime = Math.min(waitTime * 1.5, 5000);
        }

        throw new Error('Transcription timed out');
    } catch (error) {
        log('Error in getTranscription:', { error: error.message, stack: error.stack });
        throw error;
    }
}

// Clean up expired cache entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, { timestamp }] of cache.entries()) {
        if (now - timestamp > CACHE_DURATION) {
            cache.delete(key);
        }
    }
}, 60 * 60 * 1000); // Clean up every hour

// Update the transcribe endpoint to handle OPTIONS
app.options('/transcribe', cors());

app.post('/transcribe', rateLimiter, async (req, res) => {
    const startTime = Date.now();
    try {
        // Add CORS headers explicitly
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        const { url } = req.body;
        log('Received transcription request:', { 
            url,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        
        if (!url) {
            log('Error: Missing URL in request');
            return res.status(400).json({ 
                success: false,
                error: 'Missing TikTok URL in request body' 
            });
        }

        const transcription = await getTranscription(url);
        const duration = Date.now() - startTime;
        
        log('Request completed successfully', {
            url,
            duration: `${duration}ms`,
            cached: cache.has(url)
        });

        res.json({ 
            success: true,
            transcription,
            cached: cache.has(url),
            duration: `${duration}ms`
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        log('Error in /transcribe endpoint:', {
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`
        });

        res.status(500).json({ 
            success: false,
            error: error.message,
            duration: `${duration}ms`
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
}); 